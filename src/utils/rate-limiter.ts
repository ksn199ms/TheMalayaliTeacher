import { config } from '../config/env.js';

export class RateLimiter {
  private userRequests: Map<string, number[]> = new Map();
  private maxRequests: number;
  private windowMs: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(maxRequests: number = config.QUESTIONS_PER_MINUTE, windowMs: number = 60 * 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;

    // Periodic cleanup every 5 minutes to prevent memory leaks from idle users
    this.cleanupTimer = setInterval(() => this.pruneStaleUsers(), 5 * 60 * 1000);
    if (this.cleanupTimer && typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Check if user is within rate limit and record the request.
   * Returns true if allowed, false if limit exceeded.
   */
  public isAllowed(userId: string): boolean {
    const now = Date.now();
    const timestamps = this.userRequests.get(userId) || [];

    // Filter out timestamps older than the window
    const recent = timestamps.filter((t) => now - t < this.windowMs);

    if (recent.length >= this.maxRequests) {
      return false;
    }

    recent.push(now);
    this.userRequests.set(userId, recent);
    return true;
  }

  /**
   * Get seconds remaining until next slot
   */
  public getRetryAfterSeconds(userId: string): number {
    const now = Date.now();
    const timestamps = (this.userRequests.get(userId) || []).filter((t) => now - t < this.windowMs);
    if (timestamps.length === 0) return 0;

    const oldest = Math.min(...timestamps);
    const waitTime = this.windowMs - (now - oldest);
    return Math.max(1, Math.ceil(waitTime / 1000));
  }

  /**
   * Remove users whose requests have all elapsed beyond the sliding window.
   * Returns number of pruned user entries.
   */
  public pruneStaleUsers(): number {
    const now = Date.now();
    let pruned = 0;
    for (const [userId, timestamps] of this.userRequests.entries()) {
      const recent = timestamps.filter((t) => now - t < this.windowMs);
      if (recent.length === 0) {
        this.userRequests.delete(userId);
        pruned++;
      } else {
        this.userRequests.set(userId, recent);
      }
    }
    return pruned;
  }

  /**
   * Active tracked users count (useful for monitoring & testing)
   */
  public getTrackedUsersCount(): number {
    return this.userRequests.size;
  }

  /**
   * Stop background timer
   */
  public destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

export const questionRateLimiter = new RateLimiter(config.QUESTION_RATE_LIMIT_PER_MINUTE);
export const studyRateLimiter = new RateLimiter(config.STUDY_GENERATION_RATE_LIMIT_PER_MINUTE);
