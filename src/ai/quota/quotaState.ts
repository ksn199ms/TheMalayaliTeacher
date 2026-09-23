import { GeminiCircuitState } from './quotaTypes.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('gemini.quota.state');

export class QuotaState {
  private state: GeminiCircuitState = 'CLOSED';
  private openedAt?: number;
  private openReason?: string;
  private halfOpenProbeInFlight = false;

  // In-memory daily request tracking
  private currentDate: string = this.getTodayDateString();
  private totalRequests = 0;
  private successfulRequests = 0;
  private failedRequests = 0;
  private retriesCount = 0;

  /**
   * Returns current circuit state, automatically evaluating whether an OPEN circuit
   * should transition to HALF_OPEN after passing midnight Pacific Time or the probe cooldown.
   */
  public getState(): GeminiCircuitState {
    this.rollDateIfNeeded();

    if (this.state === 'OPEN') {
      const now = Date.now();
      const nextReset = this.getNextPacificMidnightTimestamp();

      // If we crossed Pacific midnight or if at least 30 minutes elapsed since open
      const minCooldownMs = 30 * 60 * 1000;
      if (now >= nextReset || (this.openedAt && now - this.openedAt >= minCooldownMs)) {
        log.info('Circuit breaker entering HALF_OPEN probe state.');
        this.state = 'HALF_OPEN';
        this.halfOpenProbeInFlight = false;
      }
    }

    return this.state;
  }

  public trip(reason: string): void {
    this.state = 'OPEN';
    this.openedAt = Date.now();
    this.openReason = reason;
    this.halfOpenProbeInFlight = false;

    log.warn(
      {
        reason,
        openedAt: new Date(this.openedAt).toISOString(),
        estimatedReset: this.getEstimatedResetString(),
      },
      'Gemini circuit breaker TRIPPED to OPEN.'
    );
  }

  public tripDailyQuota(reason: string): void {
    this.trip(reason);
  }

  public recordSuccess(): void {
    this.rollDateIfNeeded();
    this.totalRequests++;
    this.successfulRequests++;

    if (this.state === 'HALF_OPEN') {
      log.info('HALF_OPEN probe request succeeded. Circuit breaker RESET to CLOSED.');
      this.state = 'CLOSED';
      this.openedAt = undefined;
      this.openReason = undefined;
      this.halfOpenProbeInFlight = false;
    }
  }

  public recordFailure(isDailyQuota: boolean): void {
    this.rollDateIfNeeded();
    this.totalRequests++;
    this.failedRequests++;

    if (isDailyQuota) {
      this.trip('Daily Gemini quota exhausted (429 RPD).');
    } else if (this.state === 'HALF_OPEN') {
      this.trip('HALF_OPEN probe failed; reopening circuit.');
    }
  }

  public recordRetry(): void {
    this.rollDateIfNeeded();
    this.retriesCount++;
  }

  public canProbe(): boolean {
    if (this.state !== 'HALF_OPEN') return false;
    if (this.halfOpenProbeInFlight) return false;
    this.halfOpenProbeInFlight = true;
    return true;
  }

  public getOpenedAt(): number | undefined {
    return this.openedAt;
  }

  public getOpenReason(): string | undefined {
    return this.openReason;
  }

  public getCounters() {
    this.rollDateIfNeeded();
    return {
      totalRequests: this.totalRequests,
      successfulRequests: this.successfulRequests,
      failedRequests: this.failedRequests,
      retriesCount: this.retriesCount,
    };
  }

  /**
   * Resets state (useful for automated testing)
   */
  public reset(): void {
    this.state = 'CLOSED';
    this.openedAt = undefined;
    this.openReason = undefined;
    this.halfOpenProbeInFlight = false;
    this.totalRequests = 0;
    this.successfulRequests = 0;
    this.failedRequests = 0;
    this.retriesCount = 0;
  }

  /**
   * Calculates timestamp for the next midnight Pacific Time (PT).
   * Google documents that Gemini API daily quotas reset at midnight Pacific Time.
   */
  public getNextPacificMidnightTimestamp(): number {
    const now = new Date();
    // Convert to US Pacific Time representation
    const ptDateStr = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' });
    const ptTodayMidnight = new Date(`${ptDateStr} 00:00:00 GMT-0800`);

    // Next midnight is today midnight + 24 hours
    const nextMidnight = new Date(ptTodayMidnight.getTime() + 24 * 60 * 60 * 1000);
    return nextMidnight.getTime();
  }

  public getEstimatedResetString(): string {
    const nextResetTs = this.getNextPacificMidnightTimestamp();
    const diffMs = Math.max(0, nextResetTs - Date.now());
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    return `~${diffHours}h ${diffMins}m (Midnight Pacific Time estimate)`;
  }

  private rollDateIfNeeded(): void {
    const today = this.getTodayDateString();
    if (today !== this.currentDate) {
      this.currentDate = today;
      this.totalRequests = 0;
      this.successfulRequests = 0;
      this.failedRequests = 0;
      this.retriesCount = 0;
    }
  }

  private getTodayDateString(): string {
    return new Date().toISOString().slice(0, 10);
  }
}

export const quotaState = new QuotaState();
export { QuotaState as GeminiQuotaState };
