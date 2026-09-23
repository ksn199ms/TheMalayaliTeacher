import crypto from 'node:crypto';
import { GeminiRequestType, RequestPriority, GeminiQuotaStatus } from './quota/quotaTypes.js';
import { geminiQuotaManager, GeminiQuotaManager } from './quota/GeminiQuotaManager.js';
import { geminiConcurrencyQueue, GeminiConcurrencyQueue } from './concurrency/GeminiConcurrencyQueue.js';
import { geminiRetryPolicy, GeminiRetryPolicy } from './errors/GeminiRetryPolicy.js';
import { GeminiErrorClassifier } from './errors/GeminiErrorClassifier.js';
import { GeminiAPIError, GeminiErrorInfo } from './errors/GeminiError.js';
import { recordGeminiUsageToDB } from '../database/models/GeminiUsage.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('gemini.request.manager');

export interface GeminiRequestContext {
  requestId: string;
  userId: string;
  operation: GeminiRequestType;
  startedAt: number;
  geminiCallCount: number;
  maxGeminiCalls: number;
  priority?: RequestPriority;
}

export class GeminiRequestManager {
  private quotaManager: GeminiQuotaManager;
  private concurrencyQueue: GeminiConcurrencyQueue;
  private retryPolicy: GeminiRetryPolicy;

  constructor(
    quotaMgr?: GeminiQuotaManager,
    queue?: GeminiConcurrencyQueue,
    retryPol?: GeminiRetryPolicy
  ) {
    this.quotaManager = quotaMgr || geminiQuotaManager;
    this.concurrencyQueue = queue || geminiConcurrencyQueue;
    this.retryPolicy = retryPol || geminiRetryPolicy;
  }

  /**
   * Creates a structured tracking context for an operation, enforcing request budgets.
   */
  public createRequestContext(
    userId: string,
    operation: GeminiRequestType,
    maxGeminiCalls: number = config.MAX_GEMINI_CALLS_PER_USER_REQUEST,
    priority: RequestPriority = 'MEDIUM'
  ): GeminiRequestContext {
    return {
      requestId: crypto.randomUUID(),
      userId,
      operation,
      startedAt: Date.now(),
      geminiCallCount: 0,
      maxGeminiCalls,
      priority,
    };
  }

  /**
   * Central gateway executing any Gemini API call (generation or embedding)
   * through request budgets, quota circuit breaker, concurrency queues, and retry policies.
   */
  public async execute<T>(
    context: GeminiRequestContext,
    apiAction: (attempt: number) => Promise<T>
  ): Promise<T> {
    const { requestId, userId, operation, maxGeminiCalls, priority = 'MEDIUM' } = context;

    // 1. Enforce per-user-operation request budget
    if (context.geminiCallCount >= maxGeminiCalls) {
      log.warn(
        { requestId, userId, operation, callCount: context.geminiCallCount, maxGeminiCalls },
        'Gemini request budget exceeded for this user operation.'
      );
      throw new GeminiAPIError({
        httpStatus: 429,
        code: 'REQUEST_BUDGET_EXCEEDED',
        message: `Gemini request budget of ${maxGeminiCalls} calls exceeded for ${operation}.`,
        retryable: false,
        isDailyQuotaExceeded: false,
      });
    }

    // 2. Check Quota Manager / Circuit Breaker
    const quotaCheck = this.quotaManager.canMakeRequest(operation, priority);
    if (!quotaCheck.allowed) {
      log.warn({ requestId, userId, operation, reason: quotaCheck.reason }, 'Request blocked by Quota Manager / Circuit Breaker.');
      throw new GeminiAPIError({
        httpStatus: 429,
        code: 'CIRCUIT_OPEN',
        message: quotaCheck.reason || 'Gemini API is temporarily unavailable due to daily quota exhaustion.',
        retryable: false,
        quotaType: 'rpd',
        isDailyQuotaExceeded: true,
      });
    }

    // 3. Acquire concurrency slot (or wait in backpressure queue)
    const releaseSlot = await this.concurrencyQueue.acquireSlot();

    let attemptCount = 0;
    const callStartTime = Date.now();
    context.geminiCallCount++;

    try {
      // 4. Execute with centralized retry policy
      const result = await this.retryPolicy.execute(
        operation,
        async (attempt) => {
          attemptCount = attempt;
          return await apiAction(attempt);
        },
        {
          onRetry: (_attempt, _delayMs, _errInfo) => {
            this.quotaManager.recordRetry(operation);
          },
        }
      );

      const latencyMs = Date.now() - callStartTime;

      // 5. Record success in in-memory state and MongoDB rollup
      this.quotaManager.recordSuccess(operation);

      // Safe structured log (never logging prompts or sensitive data)
      log.info(
        {
          requestId,
          userId,
          operation,
          model: config.GEMINI_MODEL,
          attempts: attemptCount + 1,
          latencyMs,
          status: 'success',
        },
        'Gemini API request succeeded.'
      );

      // Fire-and-forget usage persistence
      recordGeminiUsageToDB({
        date: new Date().toISOString().slice(0, 10),
        model: config.GEMINI_MODEL,
        requestType: operation,
        success: true,
        retries: attemptCount,
      });

      return result;
    } catch (err: unknown) {
      const errorInfo: GeminiErrorInfo =
        err instanceof GeminiAPIError ? err.info : GeminiErrorClassifier.classify(err);

      const latencyMs = Date.now() - callStartTime;

      // Record failure in quota manager (trips circuit if RPD)
      this.quotaManager.recordFailure(operation, errorInfo);

      log.error(
        {
          requestId,
          userId,
          operation,
          model: config.GEMINI_MODEL,
          attempts: attemptCount + 1,
          latencyMs,
          status: errorInfo.httpStatus,
          errorType: errorInfo.quotaType || 'api_error',
          isDailyQuota: errorInfo.isDailyQuotaExceeded,
        },
        'Gemini API request failed.'
      );

      recordGeminiUsageToDB({
        date: new Date().toISOString().slice(0, 10),
        model: config.GEMINI_MODEL,
        requestType: operation,
        success: false,
        retries: attemptCount,
      });

      if (err instanceof GeminiAPIError) {
        throw err;
      }
      throw new GeminiAPIError(errorInfo);
    } finally {
      // Always release concurrency slot
      releaseSlot();
    }
  }

  public getStatus(): GeminiQuotaStatus {
    return this.quotaManager.getStatus(
      this.concurrencyQueue.getActiveCount(),
      this.concurrencyQueue.getQueueLength()
    );
  }
}

export const geminiRequestManager = new GeminiRequestManager();
