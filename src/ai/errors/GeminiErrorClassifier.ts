import { GeminiErrorInfo } from './GeminiError.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('gemini.error.classifier');

export class GeminiErrorClassifier {
  /**
   * Classifies any error caught during Gemini API execution into a structured GeminiErrorInfo
   */
  public static classify(error: unknown): GeminiErrorInfo {
    let httpStatus = 500;
    let code: string | undefined;
    let message = 'Unknown Gemini error';
    let details: any[] = [];
    let retryAfterMs: number | undefined;

    // 1. Extract status, message, and details from various possible error formats
    if (error && typeof error === 'object') {
      const errObj = error as any;
      httpStatus = errObj.status || errObj.statusCode || errObj.httpStatus || 500;
      message = errObj.message || 'Unknown Gemini error';

      // Check if message contains embedded JSON (common in @google/genai SDK)
      const parsedJson = this.tryExtractJson(message);
      if (parsedJson && parsedJson.error) {
        httpStatus = parsedJson.error.code || httpStatus;
        message = parsedJson.error.message || message;
        code = parsedJson.error.status || code;
        details = parsedJson.error.details || [];
      } else if (errObj.error && typeof errObj.error === 'object') {
        httpStatus = errObj.error.code || httpStatus;
        message = errObj.error.message || message;
        code = errObj.error.status || code;
        details = errObj.error.details || [];
      } else if (Array.isArray(errObj.details)) {
        details = errObj.details;
      }
    } else if (typeof error === 'string') {
      message = error;
      const parsedJson = this.tryExtractJson(error);
      if (parsedJson?.error) {
        httpStatus = parsedJson.error.code || 500;
        message = parsedJson.error.message || message;
        code = parsedJson.error.status;
        details = parsedJson.error.details || [];
      }
    }

    // 2. Parse RetryInfo from details or message
    retryAfterMs = this.extractRetryDelay(details, message);

    // 3. Inspect quota violations in details
    let isDailyQuotaExceeded = false;
    let quotaType: 'rpm' | 'tpm' | 'rpd' | 'unknown' | undefined;
    let quotaLimit: number | undefined;
    let quotaMetric: string | undefined;
    let quotaId: string | undefined;

    const lowerMsg = message.toLowerCase();

    // Check structured details (ErrorInfo and QuotaFailure)
    for (const detail of details) {
      if (detail['@type'] === 'type.googleapis.com/google.rpc.ErrorInfo' && detail.metadata) {
        if (detail.metadata.quota_limit_value) {
          quotaLimit = parseInt(detail.metadata.quota_limit_value, 10) || quotaLimit;
        }
        if (detail.metadata.quota_metric) {
          quotaMetric = detail.metadata.quota_metric;
        }
        if (detail.metadata.quota_id) {
          quotaId = detail.metadata.quota_id;
        }
      }

      if (detail['@type'] === 'type.googleapis.com/google.rpc.QuotaFailure' && Array.isArray(detail.violations)) {
        for (const violation of detail.violations) {
          const vQuotaId = (violation.quotaId || quotaId || '').toLowerCase();
          const vQuotaMetric = (violation.quotaMetric || quotaMetric || '').toLowerCase();

          if (
            vQuotaId.includes('perday') ||
            vQuotaId.includes('freetier') ||
            vQuotaMetric.includes('free_tier_requests') ||
            vQuotaMetric.includes('per_day')
          ) {
            isDailyQuotaExceeded = true;
            quotaType = 'rpd';
            break;
          } else if (vQuotaMetric.includes('tokens') || vQuotaId.includes('tokens') || vQuotaId.includes('tpm')) {
            quotaType = 'tpm';
          } else if (vQuotaMetric.includes('requests') || vQuotaId.includes('rpm')) {
            quotaType = 'rpm';
          }
        }
      }
    }

    // Check message heuristics if not found in structured details
    if (!quotaLimit) {
      const matchLimit = message.match(/limit:\s*(\d+)/i);
      if (matchLimit && matchLimit[1]) {
        quotaLimit = parseInt(matchLimit[1], 10);
      }
    }

    if (quotaId) {
      const lowerQuotaId = quotaId.toLowerCase();
      if (lowerQuotaId.includes('perday') || lowerQuotaId.includes('freetier')) {
        isDailyQuotaExceeded = true;
        quotaType = 'rpd';
      }
    }

    if (quotaMetric) {
      const lowerMetric = quotaMetric.toLowerCase();
      if (lowerMetric.includes('free_tier_requests') || lowerMetric.includes('per_day')) {
        isDailyQuotaExceeded = true;
        quotaType = 'rpd';
      }
    }

    if (!quotaType && httpStatus === 429) {
      if (
        lowerMsg.includes('generaterequestsperday') ||
        lowerMsg.includes('free_tier_requests') ||
        lowerMsg.includes('per day') ||
        lowerMsg.includes('daily') ||
        (lowerMsg.includes('resource_exhausted') && lowerMsg.includes('limit: 20'))
      ) {
        isDailyQuotaExceeded = true;
        quotaType = 'rpd';
      } else if (lowerMsg.includes('token') || lowerMsg.includes('tpm')) {
        quotaType = 'tpm';
      } else {
        quotaType = 'rpm';
      }
    }

    // 4. Determine retryability
    let retryable = false;

    if (isDailyQuotaExceeded) {
      retryable = false;
    } else {
      switch (httpStatus) {
        case 400: // Invalid request
        case 401: // Authentication
        case 403: // Permission / billing / key
        case 404: // Model not found
          retryable = false;
          break;
        case 429: // Rate limit (RPM / TPM)
        case 500: // Server internal
        case 503: // Service unavailable / high demand
        case 504: // Gateway timeout
          retryable = true;
          break;
        default:
          retryable = false;
      }
    }

    const info: GeminiErrorInfo = {
      httpStatus,
      code,
      message,
      retryable,
      quotaType,
      quotaLimit,
      quotaMetric,
      quotaId,
      retryAfterMs,
      isDailyQuotaExceeded,
      raw: error,
    };

    log.debug(
      {
        httpStatus,
        retryable,
        quotaType,
        isDailyQuotaExceeded,
        retryAfterMs,
      },
      'Classified Gemini API error.'
    );

    return info;
  }

  private static tryExtractJson(text: string): any {
    if (!text || typeof text !== 'string') return null;
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');
    if (startIdx !== -1 && endIdx > startIdx) {
      try {
        const jsonStr = text.substring(startIdx, endIdx + 1);
        return JSON.parse(jsonStr);
      } catch {
        return null;
      }
    }
    return null;
  }

  private static extractRetryDelay(details: any[], message: string): number | undefined {
    // 1. Look for google.rpc.RetryInfo in details
    if (Array.isArray(details)) {
      for (const detail of details) {
        if (detail['@type'] === 'type.googleapis.com/google.rpc.RetryInfo' && detail.retryDelay) {
          const delayStr = String(detail.retryDelay).trim();
          // e.g. "25s", "25.5s"
          const secMatch = delayStr.match(/^([\d.]+)s?$/i);
          if (secMatch) {
            const sec = parseFloat(secMatch[1]);
            if (!isNaN(sec) && sec > 0) {
              return Math.round(sec * 1000);
            }
          }
        }
      }
    }

    // 2. Look for "retry after X seconds" or "retry in Xs" in message
    const msgMatch = message.match(/retry (?:after|in) ([\d.]+) ?s/i);
    if (msgMatch) {
      const sec = parseFloat(msgMatch[1]);
      if (!isNaN(sec) && sec > 0) {
        return Math.round(sec * 1000);
      }
    }

    return undefined;
  }
}
