import { Schema, model } from 'mongoose';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('gemini.usage.model');

export interface IGeminiUsage {
  date: string; // YYYY-MM-DD
  model: string;
  requestType: string;
  requestCount: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  inputTokens: number;
  outputTokens: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const GeminiUsageSchema = new Schema<IGeminiUsage>(
  {
    date: { type: String, required: true, index: true },
    model: { type: String, required: true, index: true },
    requestType: { type: String, required: true, index: true },
    requestCount: { type: Number, default: 0 },
    successCount: { type: Number, default: 0 },
    failureCount: { type: Number, default: 0 },
    retryCount: { type: Number, default: 0 },
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
  },
  {
    timestamps: true,
  }
);

// Compound unique index for daily rollups
GeminiUsageSchema.index({ date: 1, model: 1, requestType: 1 }, { unique: true });

export const GeminiUsageModel = model<IGeminiUsage>('GeminiUsage', GeminiUsageSchema);

/**
 * Asynchronously records daily aggregated Gemini usage into MongoDB
 * using atomic $inc operations. Fails safely without throwing into caller path.
 */
export async function recordGeminiUsageToDB(stats: {
  date: string;
  model: string;
  requestType: string;
  success: boolean;
  retries?: number;
  inputTokens?: number;
  outputTokens?: number;
}): Promise<void> {
  try {
    const incObj: Record<string, number> = {
      requestCount: 1,
      successCount: stats.success ? 1 : 0,
      failureCount: stats.success ? 0 : 1,
      retryCount: stats.retries || 0,
      inputTokens: stats.inputTokens || 0,
      outputTokens: stats.outputTokens || 0,
    };

    await GeminiUsageModel.updateOne(
      { date: stats.date, model: stats.model, requestType: stats.requestType },
      { $inc: incObj },
      { upsert: true }
    );
  } catch (error: any) {
    // Non-blocking: database analytics failures should never crash application requests
    log.warn({ error: error.message }, 'Failed to write Gemini usage rollup to MongoDB.');
  }
}
