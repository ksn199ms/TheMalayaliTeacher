import crypto from 'node:crypto';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('gemini.deduplicator');

interface CacheEntry {
  answer: string;
  expiresAt: number;
}

export class GeminiDeduplicator {
  private inFlightLocks: Map<string, number> = new Map();
  private responseCache: Map<string, CacheEntry> = new Map();
  private ttlMs: number;

  constructor(ttlSeconds: number = config.GEMINI_RESPONSE_CACHE_TTL_SECONDS) {
    this.ttlMs = ttlSeconds * 1000;
  }

  /**
   * Attempts to acquire an in-flight operation lock for a specific user and operation.
   * Prevents rapid duplicate requests (e.g. multiple button taps for summaries or quizzes).
   * Automatically expires locks older than 120 seconds to prevent deadlocks.
   */
  public acquireLock(userId: string, operation: string, targetId: string = 'default'): boolean {
    const key = `${userId}:${operation}:${targetId}`;
    const now = Date.now();
    const existing = this.inFlightLocks.get(key);

    if (existing && now - existing < 120000) {
      log.warn({ userId, operation, targetId }, 'Duplicate in-flight operation blocked by lock.');
      return false;
    }

    this.inFlightLocks.set(key, now);
    return true;
  }

  /**
   * Releases the in-flight operation lock
   */
  public releaseLock(userId: string, operation: string, targetId: string = 'default'): void {
    const key = `${userId}:${operation}:${targetId}`;
    this.inFlightLocks.delete(key);
  }

  /**
   * Retrieves a cached response if available and not expired.
   * Strictly user-scoped to prevent any cross-user data leakage.
   */
  public getCachedResponse(
    userId: string,
    question: string,
    documentIds: string[] = [],
    indexVersion: number = config.INDEX_VERSION
  ): string | null {
    const key = this.buildCacheKey(userId, question, documentIds, indexVersion);
    const entry = this.responseCache.get(key);

    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.responseCache.delete(key);
      return null;
    }

    log.debug({ userId, questionLength: question.length }, 'Returning cached Gemini response.');
    return entry.answer;
  }

  /**
   * Stores a response in the user-scoped cache for short-lived deduplication
   */
  public setCachedResponse(
    userId: string,
    question: string,
    answer: string,
    documentIds: string[] = [],
    indexVersion: number = config.INDEX_VERSION
  ): void {
    const key = this.buildCacheKey(userId, question, documentIds, indexVersion);
    this.responseCache.set(key, {
      answer,
      expiresAt: Date.now() + this.ttlMs,
    });
  }

  /**
   * Clears all locks and caches (useful for automated testing)
   */
  public clear(): void {
    this.inFlightLocks.clear();
    this.responseCache.clear();
  }

  private buildCacheKey(
    userId: string,
    question: string,
    documentIds: string[],
    indexVersion: number
  ): string {
    const cleanQ = question.trim().toLowerCase();
    const sortedDocs = [...documentIds].sort().join(',');
    const raw = `${userId}:${cleanQ}:${sortedDocs}:v${indexVersion}`;
    return crypto.createHash('sha256').update(raw).digest('hex');
  }
}

export const geminiDeduplicator = new GeminiDeduplicator();
