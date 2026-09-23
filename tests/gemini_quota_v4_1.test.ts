import { describe, it, expect, beforeEach } from 'vitest';
import { GeminiErrorClassifier } from '../src/ai/errors/GeminiErrorClassifier.js';
import { GeminiRetryPolicy } from '../src/ai/errors/GeminiRetryPolicy.js';
import { GeminiQuotaState } from '../src/ai/quota/quotaState.js';
import { GeminiQuotaManager } from '../src/ai/quota/GeminiQuotaManager.js';
import { GeminiConcurrencyQueue, GeminiQueueOverflowError } from '../src/ai/concurrency/GeminiConcurrencyQueue.js';
import { GeminiDeduplicator } from '../src/ai/cache/GeminiDeduplicator.js';
import { GeminiRequestManager } from '../src/ai/GeminiRequestManager.js';
import { mapGeminiErrorToUserMessage } from '../src/bot/utils/geminiErrorMapper.js';
import { GeminiAPIError } from '../src/ai/errors/GeminiError.js';

describe('V4.1: Gemini Quota Management, Retries & Cost Optimization', () => {
  // Production 429 JSON Error Fixture from real log
  const production429Fixture = {
    error: {
      code: 429,
      message:
        'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests limit: 20 model: gemini-3.8-flash',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'RATE_LIMIT_EXCEEDED',
          domain: 'googleapis.com',
          metadata: {
            quota_limit_value: '20',
            quota_metric: 'generativelanguage.googleapis.com/generate_content_free_tier_requests',
            quota_id: 'GenerateRequestsPerDayPerProject-FreeTier',
            service: 'generativelanguage.googleapis.com',
          },
        },
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [
            {
              subject: 'project:1234567890',
              description:
                'Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests limit: 20 model: gemini-3.8-flash',
            },
          ],
        },
        {
          '@type': 'type.googleapis.com/google.rpc.RetryInfo',
          retryDelay: '82800s',
        },
      ],
    },
  };

  describe('1. Gemini Error Classifier', () => {
    it('correctly classifies production 429 Daily Free Tier Quota Exhaustion as non-retryable RPD', () => {
      const classified = GeminiErrorClassifier.classify(production429Fixture);

      expect(classified.httpStatus).toBe(429);
      expect(classified.isDailyQuotaExceeded).toBe(true);
      expect(classified.quotaType).toBe('rpd');
      expect(classified.retryable).toBe(false); // MUST NEVER BE RETRIED
      expect(classified.quotaLimit).toBe(20);
      expect(classified.quotaMetric).toBe('generativelanguage.googleapis.com/generate_content_free_tier_requests');
      expect(classified.quotaId).toBe('GenerateRequestsPerDayPerProject-FreeTier');
      expect(classified.retryAfterMs).toBe(82800 * 1000);
    });

    it('classifies temporary 429 RPM/TPM rate limits as retryable', () => {
      const rpmError = {
        status: 429,
        message: 'Resource has been exhausted (e.g. check quota). Rate limit exceeded: requests per minute.',
      };

      const classified = GeminiErrorClassifier.classify(rpmError);
      expect(classified.httpStatus).toBe(429);
      expect(classified.isDailyQuotaExceeded).toBe(false);
      expect(classified.quotaType).toBe('rpm');
      expect(classified.retryable).toBe(true);
    });

    it('classifies 500, 503, and 504 server errors as retryable', () => {
      const err500 = GeminiErrorClassifier.classify(new Error('500 Internal Server Error'));
      const err503 = GeminiErrorClassifier.classify({ status: 503, message: 'Service Unavailable' });
      const err504 = GeminiErrorClassifier.classify({ status: 504, message: 'Gateway Timeout' });

      expect(err500.retryable).toBe(true);
      expect(err503.retryable).toBe(true);
      expect(err504.retryable).toBe(true);
    });

    it('classifies 400, 401, 403, and 404 client errors as non-retryable', () => {
      const err400 = GeminiErrorClassifier.classify({ status: 400, message: 'Invalid argument' });
      const err401 = GeminiErrorClassifier.classify({ status: 401, message: 'API key not valid' });
      const err403 = GeminiErrorClassifier.classify({ status: 403, message: 'Permission denied' });
      const err404 = GeminiErrorClassifier.classify({ status: 404, message: 'Model not found' });

      expect(err400.retryable).toBe(false);
      expect(err401.retryable).toBe(false);
      expect(err403.retryable).toBe(false);
      expect(err404.retryable).toBe(false);
    });
  });

  describe('2. Gemini Retry Policy', () => {
    it('never retries daily quota exhaustion errors', () => {
      const classified = GeminiErrorClassifier.classify(production429Fixture);
      const decision = GeminiRetryPolicy.evaluate(classified, 1, 100);

      expect(decision.shouldRetry).toBe(false);
      expect(decision.delayMs).toBe(0);
      expect(decision.reason).toBe('daily_quota_exceeded');
    });

    it('never retries non-retryable 400/401 errors', () => {
      const classified = GeminiErrorClassifier.classify({ status: 400, message: 'Bad request' });
      const decision = GeminiRetryPolicy.evaluate(classified, 1, 100);

      expect(decision.shouldRetry).toBe(false);
      expect(decision.reason).toBe('error_not_retryable');
    });

    it('calculates exponential backoff with jitter for retryable errors', () => {
      const classified = GeminiErrorClassifier.classify({ status: 503, message: 'Temporary spike' });

      const d1 = GeminiRetryPolicy.evaluate(classified, 1, 100);
      expect(d1.shouldRetry).toBe(true);
      expect(d1.delayMs).toBeGreaterThanOrEqual(1000); // 1000ms base + jitter
      expect(d1.delayMs).toBeLessThanOrEqual(2500);

      const d2 = GeminiRetryPolicy.evaluate(classified, 2, 2000);
      expect(d2.shouldRetry).toBe(true);
      expect(d2.delayMs).toBeGreaterThanOrEqual(2000); // 2000ms base + jitter
    });

    it('stops retrying when max retries is reached', () => {
      const classified = GeminiErrorClassifier.classify({ status: 503, message: 'Unavailable' });
      const decision = GeminiRetryPolicy.evaluate(classified, 4, 5000); // Attempt 4 exceeds max 3

      expect(decision.shouldRetry).toBe(false);
      expect(decision.reason).toBe('max_retries_reached');
    });

    it('stops retrying when total elapsed time exceeds limit', () => {
      const classified = GeminiErrorClassifier.classify({ status: 503, message: 'Unavailable' });
      const decision = GeminiRetryPolicy.evaluate(classified, 2, 70000); // 70s > 60s max

      expect(decision.shouldRetry).toBe(false);
      expect(decision.reason).toBe('max_total_retry_time_exceeded');
    });
  });

  describe('3. Circuit Breaker & Quota State Transitions', () => {
    let state: GeminiQuotaState;
    let manager: GeminiQuotaManager;

    beforeEach(() => {
      state = new GeminiQuotaState();
      manager = new GeminiQuotaManager(state);
    });

    it('initializes in CLOSED state with allowed requests', () => {
      expect(state.getState()).toBe('CLOSED');
      const admission = manager.canMakeRequest('answer');
      expect(admission.allowed).toBe(true);
    });

    it('transitions immediately to OPEN state when daily quota error occurs', () => {
      const classified = GeminiErrorClassifier.classify(production429Fixture);
      manager.recordFailure('answer', classified);

      expect(state.getState()).toBe('OPEN');
      const admission = manager.canMakeRequest('answer');
      expect(admission.allowed).toBe(false);
      expect(admission.reason?.toLowerCase()).toContain('daily');
    });

    it('allows a probe request in HALF_OPEN state and recovers to CLOSED upon success', () => {
      state.tripDailyQuota('Daily limit test');
      expect(state.getState()).toBe('OPEN');

      // Artificially simulate 31 minutes cooldown passing
      (state as any).openedAt = Date.now() - (31 * 60 * 1000);

      // Admission check transitions to HALF_OPEN and allows probe
      const admission = manager.canMakeRequest('answer');
      expect(admission.allowed).toBe(true);
      expect(state.getState()).toBe('HALF_OPEN');

      // Record successful probe
      manager.recordSuccess('answer');
      expect(state.getState()).toBe('CLOSED');
    });
  });

  describe('4. Concurrency Queue & Backpressure', () => {
    it('executes tasks within concurrency limit and queues tasks above limit', async () => {
      const queue = new GeminiConcurrencyQueue(2, 5);
      let concurrentActive = 0;
      let maxSeenActive = 0;

      const task = async (id: number) => {
        return queue.execute(async () => {
          concurrentActive++;
          if (concurrentActive > maxSeenActive) maxSeenActive = concurrentActive;
          await new Promise((r) => setTimeout(r, 20));
          concurrentActive--;
          return id;
        });
      };

      const results = await Promise.all([task(1), task(2), task(3), task(4)]);

      expect(results).toEqual([1, 2, 3, 4]);
      expect(maxSeenActive).toBeLessThanOrEqual(2);
    });

    it('throws GeminiQueueOverflowError immediately when queue capacity is exceeded', async () => {
      const queue = new GeminiConcurrencyQueue(1, 1); // Max 1 active, Max 1 queued

      let resolveActive: () => void = () => {};
      const blockPromise = new Promise<void>((r) => {
        resolveActive = r;
      });

      // 1. Task 1 starts and blocks active slot
      const t1 = queue.execute(async () => {
        await blockPromise;
        return 1;
      });

      // 2. Task 2 queues (occupies the 1 queue slot)
      const t2 = queue.execute(async () => {
        return 2;
      });

      // 3. Task 3 attempts to queue -> should reject immediately with GeminiQueueOverflowError
      await expect(
        queue.execute(async () => {
          return 3;
        })
      ).rejects.toThrow(GeminiQueueOverflowError);

      resolveActive();
      await Promise.all([t1, t2]);
    });
  });

  describe('5. Deduplication, In-Flight Locks & Response Caching', () => {
    let deduplicator: GeminiDeduplicator;

    beforeEach(() => {
      deduplicator = new GeminiDeduplicator(60);
    });

    it('prevents simultaneous duplicate button presses for same user and operation', () => {
      const userId = 'user_123';
      const docId = 'doc_abc';

      const lock1 = deduplicator.acquireLock(userId, 'summary', docId);
      expect(lock1).toBe(true);

      const lock2 = deduplicator.acquireLock(userId, 'summary', docId);
      expect(lock2).toBe(false); // Blocked

      deduplicator.releaseLock(userId, 'summary', docId);

      const lock3 = deduplicator.acquireLock(userId, 'summary', docId);
      expect(lock3).toBe(true); // Now allowed
      deduplicator.releaseLock(userId, 'summary', docId);
    });

    it('caches generated responses with user isolation and respects TTL', () => {
      const userA = 'user_A';
      const userB = 'user_B';
      const prompt = 'Explain Newton laws';

      expect(deduplicator.getCachedResponse(userA, prompt)).toBeNull();

      deduplicator.setCachedResponse(userA, prompt, 'Newton laws are...');

      // User A hits cache
      expect(deduplicator.getCachedResponse(userA, prompt)).toBe('Newton laws are...');

      // User B has user-isolation and does NOT hit User A cache
      expect(deduplicator.getCachedResponse(userB, prompt)).toBeNull();
    });
  });

  describe('6. Gemini Request Manager & Request Budget', () => {
    it('enforces maximum Gemini calls per user request budget (3 calls max)', async () => {
      const requestManager = new GeminiRequestManager();

      const context = requestManager.createRequestContext('user_test', 'answer', 3);

      // Call 1: Embed query (budget 1/3)
      await requestManager.execute(context, async () => 'embed_result');
      expect(context.geminiCallCount).toBe(1);

      // Call 2: Generate Answer (budget 2/3)
      await requestManager.execute(context, async () => 'answer_result');
      expect(context.geminiCallCount).toBe(2);

      // Call 3: Additional call (budget 3/3)
      await requestManager.execute(context, async () => 'extra_result');
      expect(context.geminiCallCount).toBe(3);

      // Call 4: Exceeds budget (4/3) -> should throw GeminiAPIError immediately
      await expect(
        requestManager.execute(context, async () => 'overflow_result')
      ).rejects.toThrow(/Gemini request budget/);
    });
  });

  describe('7. Friendly Telegram Error Mapper', () => {
    it('maps Daily Quota 429 error into friendly user message without technical leakage', () => {
      const classified = GeminiErrorClassifier.classify(production429Fixture);
      const apiError = new GeminiAPIError(classified);

      const msg = mapGeminiErrorToUserMessage(apiError);

      expect(msg).toContain('daily AI request quota');
      expect(msg).not.toContain('RESOURCE_EXHAUSTED');
      expect(msg).not.toContain('GenerateRequestsPerDayPerProject-FreeTier');
      expect(msg).not.toContain('generativelanguage.googleapis.com');
      expect(msg).not.toContain('project:');
    });

    it('maps temporary 429 rate limits to retry wait time message', () => {
      const err = new GeminiAPIError({
        httpStatus: 429,
        statusText: 'Too Many Requests',
        isDailyQuotaExceeded: false,
        quotaType: 'rpm',
        retryable: true,
        retryAfterMs: 15000,
        message: 'Rate limit exceeded',
      });

      const msg = mapGeminiErrorToUserMessage(err);
      expect(msg).toContain('15 seconds');
      expect(msg).not.toContain('RPM');
    });

    it('maps GeminiQueueOverflowError to service busy message', () => {
      const err = new GeminiQueueOverflowError();
      const msg = mapGeminiErrorToUserMessage(err);

      expect(msg).toContain('service is currently busy');
    });

    it('maps duplicate in-flight lock error cleanly', () => {
      const msg = mapGeminiErrorToUserMessage(new Error('Request is already being processed'));
      expect(msg).toBe('⏳ Your request is already being processed. Please wait a moment!');
    });
  });
});
