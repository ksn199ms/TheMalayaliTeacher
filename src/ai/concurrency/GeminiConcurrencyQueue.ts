import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('gemini.concurrency.queue');

export class GeminiQueueOverflowError extends Error {
  constructor(message = 'AI service is currently experiencing heavy load. Queue is full.') {
    super(message);
    this.name = 'GeminiQueueOverflowError';
    Object.setPrototypeOf(this, GeminiQueueOverflowError.prototype);
  }
}

export class GeminiConcurrencyQueue {
  private maxConcurrent: number;
  private maxQueueSize: number;
  private activeCount = 0;
  private queue: Array<() => void> = [];

  constructor(
    maxConcurrent: number = config.GEMINI_MAX_CONCURRENT_REQUESTS,
    maxQueueSize: number = config.GEMINI_MAX_QUEUE_SIZE
  ) {
    this.maxConcurrent = maxConcurrent;
    this.maxQueueSize = maxQueueSize;
  }

  /**
   * Acquires a concurrency slot or queues the caller.
   * Returns a release function that MUST be invoked when the operation finishes.
   * Throws GeminiQueueOverflowError if the queue exceeds GEMINI_MAX_QUEUE_SIZE.
   */
  public async acquireSlot(): Promise<() => void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return this.createReleaseFunction();
    }

    if (this.queue.length >= this.maxQueueSize) {
      log.warn(
        { activeCount: this.activeCount, queueLength: this.queue.length, maxQueueSize: this.maxQueueSize },
        'Gemini concurrency queue overflow; rejecting request with backpressure.'
      );
      throw new GeminiQueueOverflowError('The AI study service is currently busy with other requests. Please try again shortly.');
    }

    log.debug(
      { activeCount: this.activeCount, queueLength: this.queue.length },
      'Gemini concurrency limit reached; queuing request...'
    );

    await new Promise<void>((resolve) => {
      this.queue.push(resolve);
    });

    this.activeCount++;
    return this.createReleaseFunction();
  }

  /**
   * Helper that automatically acquires a concurrency slot, executes the task,
   * and guarantees slot release even upon failure.
   */
  public async execute<T>(task: () => Promise<T>): Promise<T> {
    const release = await this.acquireSlot();
    try {
      return await task();
    } finally {
      release();
    }
  }

  public getActiveCount(): number {
    return this.activeCount;
  }

  public getQueueLength(): number {
    return this.queue.length;
  }

  public reset(): void {
    this.activeCount = 0;
    this.queue = [];
  }

  private createReleaseFunction(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeCount--;

      if (this.queue.length > 0) {
        const next = this.queue.shift();
        if (next) {
          next();
        }
      }
    };
  }
}

export const geminiConcurrencyQueue = new GeminiConcurrencyQueue();
