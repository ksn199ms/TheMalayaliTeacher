import { quotaState, QuotaState } from './quotaState.js';
import { GeminiRequestType, RequestPriority, GeminiQuotaStatus } from './quotaTypes.js';
import { GeminiErrorInfo } from '../errors/GeminiError.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('gemini.quota.manager');

export class GeminiQuotaManager {
  private state: QuotaState;

  constructor(stateInstance?: QuotaState) {
    this.state = stateInstance || quotaState;
  }

  /**
   * Determines whether an AI request of the given type and priority should be permitted.
   * Immediately rejects all requests if the circuit breaker is OPEN.
   */
  public canMakeRequest(
    type: GeminiRequestType,
    priority: RequestPriority = 'MEDIUM'
  ): { allowed: boolean; reason?: string } {
    const circuit = this.state.getState();

    if (circuit === 'OPEN') {
      const reason = this.state.getOpenReason() || 'Gemini daily free-tier quota exhausted.';
      return {
        allowed: false,
        reason: `Circuit Breaker is OPEN. ${reason} (Reset: ${this.state.getEstimatedResetString()})`,
      };
    }

    if (circuit === 'HALF_OPEN') {
      // Allow only a single probe request through
      if (this.state.canProbe()) {
        log.info({ type, priority }, 'Allowing single test probe through HALF_OPEN circuit.');
        return { allowed: true };
      }
      return {
        allowed: false,
        reason: 'Circuit is HALF_OPEN and a test probe request is already in-flight.',
      };
    }

    // Circuit is CLOSED: check priority-based load shedding if needed
    // Low-priority operations (e.g. query-expansion or optional reranking) can be shed if quota is tight
    return { allowed: true };
  }

  public recordSuccess(type: GeminiRequestType): void {
    log.debug({ type }, 'Recording successful Gemini request.');
    this.state.recordSuccess();
  }

  public recordFailure(type: GeminiRequestType, errorInfo: GeminiErrorInfo): void {
    log.warn(
      {
        type,
        httpStatus: errorInfo.httpStatus,
        quotaType: errorInfo.quotaType,
        isDailyQuotaExceeded: errorInfo.isDailyQuotaExceeded,
      },
      'Recording failed Gemini request.'
    );
    this.state.recordFailure(errorInfo.isDailyQuotaExceeded);
  }

  public recordRetry(_type?: GeminiRequestType): void {
    this.state.recordRetry();
  }

  public getStatus(activeConcurrency = 0, queued = 0): GeminiQuotaStatus {
    const counters = this.state.getCounters();
    return {
      circuitState: this.state.getState(),
      openedAt: this.state.getOpenedAt(),
      openReason: this.state.getOpenReason(),
      estimatedResetTime: this.state.getEstimatedResetString(),
      concurrency: {
        active: activeConcurrency,
        max: config.GEMINI_MAX_CONCURRENT_REQUESTS,
        queued,
      },
      observedToday: counters,
    };
  }

  public reset(): void {
    this.state.reset();
  }
}

export const geminiQuotaManager = new GeminiQuotaManager();
