/**
 * Gemini Error Representation
 * Provides structured classification for API errors, distinguishing temporary rate limits
 * from daily quota exhaustion and unretryable errors.
 */

export interface GeminiErrorInfo {
  httpStatus: number;
  code?: string;
  type?: string;
  message: string;
  retryable: boolean;
  quotaType?: 'rpm' | 'tpm' | 'rpd' | 'unknown';
  quotaLimit?: number;
  quotaMetric?: string;
  quotaId?: string;
  retryAfterMs?: number;
  isDailyQuotaExceeded: boolean;
  raw?: unknown;
}

export class GeminiAPIError extends Error {
  public readonly info: GeminiErrorInfo;

  constructor(info: GeminiErrorInfo) {
    super(info.message);
    this.name = 'GeminiAPIError';
    this.info = info;
    Object.setPrototypeOf(this, GeminiAPIError.prototype);
  }
}
