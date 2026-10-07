import { GeminiErrorClassifier } from '../../ai/errors/GeminiErrorClassifier.js';
import { GeminiAPIError } from '../../ai/errors/GeminiError.js';
import { GeminiQueueOverflowError } from '../../ai/concurrency/GeminiConcurrencyQueue.js';

/**
 * Maps any internal AI/Gemini or system error into a friendly, professional Telegram message.
 * Strictly guarantees that no raw JSON, API keys, quota IDs, or stack traces are ever sent to users.
 */
export function mapGeminiErrorToUserMessage(error: unknown): string {
  if (error instanceof GeminiQueueOverflowError) {
    return '⚠️ The AI study service is currently busy with multiple requests. Please try again in a few moments.';
  }

  const errStr = error instanceof Error ? error.message : String(error);

  // Check if duplicate lock rejection
  if (errStr.includes('already being processed') || errStr.includes('in-flight')) {
    return '⏳ Your request is already being processed. Please wait a moment!';
  }

  // Check if timeout
  if (errStr.toLowerCase().includes('timed out') || errStr.toLowerCase().includes('timeout')) {
    return '⏳ The request took longer than expected to process. Please try asking again in a moment.';
  }

  // Check if request budget exceeded
  if (errStr.includes('budget') || errStr.includes('REQUEST_BUDGET_EXCEEDED')) {
    return '⚠️ The maximum AI operation budget for this request was reached. Please try a simpler or more specific query.';
  }

  const errorInfo =
    error instanceof GeminiAPIError ? error.info : GeminiErrorClassifier.classify(error);

  // 1. Daily Quota Exhaustion (429 RPD)
  if (errorInfo.isDailyQuotaExceeded || errorInfo.quotaType === 'rpd') {
    return '⚠️ Gemini is temporarily unavailable. The daily AI request quota for this project has been reached. Please try again later.';
  }

  // 2. Temporary Rate Limits (RPM / TPM)
  if (errorInfo.httpStatus === 429) {
    const delaySec = errorInfo.retryAfterMs ? Math.ceil(errorInfo.retryAfterMs / 1000) : null;
    if (delaySec) {
      return `⏳ Gemini is temporarily busy. Please wait ~${delaySec} seconds before trying again.`;
    }
    return '⏳ Gemini is currently busy with high traffic. Please try again in a few moments.';
  }

  // 3. Service Unavailable / Server Spikes (503 / 500 / 504)
  if (errorInfo.httpStatus === 503 || errStr.toLowerCase().includes('high demand') || errStr.toLowerCase().includes('unavailable')) {
    return '⚠️ Gemini is currently experiencing high demand. Spikes are temporary—please try again shortly.';
  }

  if (errorInfo.httpStatus === 500 || errorInfo.httpStatus === 504) {
    return '⚠️ AI service encountered a temporary server error. Please try again in a moment.';
  }

  // 4. Configuration & Authentication (401 / 403)
  if (errorInfo.httpStatus === 401 || errorInfo.httpStatus === 403) {
    return '⚠️ AI service configuration issue. Please contact the bot administrator.';
  }

  // 5. Invalid Request (400 / 404)
  if (errorInfo.httpStatus === 400 || errorInfo.httpStatus === 404) {
    return '⚠️ Could not process this request with the current AI model. Please try modifying your query.';
  }

  // Default clean fallback
  return '⚠️ An error occurred while communicating with the AI service. Please try again in a moment.';
}
