import { GeminiErrorClassifier } from './GeminiErrorClassifier.js';
import { GeminiAPIError, GeminiErrorInfo } from './GeminiError.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('gemini.retry.policy');

export interface RetryPolicyOptions {
  maxRetries?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  jitterMs?: number;
  maxTotalRetryTimeMs?: number;
  onRetry?: (attempt: number, delayMs: number, errorInfo: GeminiErrorInfo) => void;
}

export class GeminiRetryPolicy {
  private maxRetries: number;
  private initialDelayMs: number;
  private maxDelayMs: number;
  private jitterMs: number;
  private maxTotalRetryTimeMs: number;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxRetries = options.maxRetries ?? config.GEMINI_MAX_RETRIES;
    this.initialDelayMs = options.initialDelayMs ?? config.GEMINI_INITIAL_RETRY_DELAY_MS;
    this.maxDelayMs = options.maxDelayMs ?? config.GEMINI_MAX_RETRY_DELAY_MS;
    this.jitterMs = options.jitterMs ?? config.GEMINI_RETRY_JITTER_MS;
    this.maxTotalRetryTimeMs = options.maxTotalRetryTimeMs ?? config.GEMINI_MAX_RETRY_TIME_MS;
  }

  /**
   * Evaluates whether a given error should be retried, computing delay and reason.
   */
  public static evaluate(
    errorInfo: GeminiErrorInfo,
    attempt: number,
    elapsedMs: number,
    options?: RetryPolicyOptions
  ): { shouldRetry: boolean; delayMs: number; reason?: string } {
    const maxRetries = options?.maxRetries ?? config.GEMINI_MAX_RETRIES;
    const initialDelayMs = options?.initialDelayMs ?? config.GEMINI_INITIAL_RETRY_DELAY_MS;
    const maxDelayMs = options?.maxDelayMs ?? config.GEMINI_MAX_RETRY_DELAY_MS;
    const jitterMs = options?.jitterMs ?? config.GEMINI_RETRY_JITTER_MS;
    const maxTotalRetryTimeMs = options?.maxTotalRetryTimeMs ?? config.GEMINI_MAX_RETRY_TIME_MS;

    if (errorInfo.isDailyQuotaExceeded || errorInfo.quotaType === 'rpd') {
      return { shouldRetry: false, delayMs: 0, reason: 'daily_quota_exceeded' };
    }

    if (!errorInfo.retryable) {
      return { shouldRetry: false, delayMs: 0, reason: 'error_not_retryable' };
    }

    if (attempt > maxRetries) {
      return { shouldRetry: false, delayMs: 0, reason: 'max_retries_reached' };
    }

    if (elapsedMs >= maxTotalRetryTimeMs) {
      return { shouldRetry: false, delayMs: 0, reason: 'max_total_retry_time_exceeded' };
    }

    // Calculate backoff delay
    let delayMs: number;
    if (errorInfo.retryAfterMs && errorInfo.retryAfterMs > 0) {
      delayMs = Math.min(errorInfo.retryAfterMs, maxDelayMs);
    } else {
      const expBackoff = Math.min(initialDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
      const jitter = Math.floor(Math.random() * (jitterMs + 1));
      delayMs = expBackoff + jitter;
    }

    if (elapsedMs + delayMs > maxTotalRetryTimeMs) {
      delayMs = Math.max(0, maxTotalRetryTimeMs - elapsedMs);
    }

    return { shouldRetry: true, delayMs };
  }

  /**
   * Executes an asynchronous Gemini action with exponential backoff, jitter, and RetryInfo respect.
   * Immediately halts if the error is classified as non-retryable or daily quota exceeded.
   */
  public async execute<T>(
    operationName: string,
    action: (attempt: number) => Promise<T>,
    customOptions?: RetryPolicyOptions
  ): Promise<T> {
    const maxRetries = customOptions?.maxRetries ?? this.maxRetries;
    const initialDelayMs = customOptions?.initialDelayMs ?? this.initialDelayMs;
    const maxDelayMs = customOptions?.maxDelayMs ?? this.maxDelayMs;
    const jitterMs = customOptions?.jitterMs ?? this.jitterMs;
    const maxTotalRetryTimeMs = customOptions?.maxTotalRetryTimeMs ?? this.maxTotalRetryTimeMs;

    const startTime = Date.now();
    let attempt = 0;

    while (true) {
      try {
        return await action(attempt);
      } catch (err: unknown) {
        const errorInfo = GeminiErrorClassifier.classify(err);

        attempt++;
        const elapsed = Date.now() - startTime;
        const decision = GeminiRetryPolicy.evaluate(errorInfo, attempt, elapsed, {
          maxRetries,
          initialDelayMs,
          maxDelayMs,
          jitterMs,
          maxTotalRetryTimeMs,
        });

        if (!decision.shouldRetry) {
          log.warn(
            {
              operationName,
              attempt,
              isDailyQuota: errorInfo.isDailyQuotaExceeded,
              httpStatus: errorInfo.httpStatus,
              reason: decision.reason || errorInfo.message,
            },
            'Gemini operation retry aborted.'
          );
          throw new GeminiAPIError(errorInfo);
        }

        const delayMs = decision.delayMs;

        log.warn(
          {
            operationName,
            attempt,
            maxRetries,
            delayMs,
            httpStatus: errorInfo.httpStatus,
            quotaType: errorInfo.quotaType,
          },
          'Gemini temporary rate limit / transient failure; backing off...'
        );

        if (customOptions?.onRetry) {
          customOptions.onRetry(attempt, delayMs, errorInfo);
        }

        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
}

export const geminiRetryPolicy = new GeminiRetryPolicy();
