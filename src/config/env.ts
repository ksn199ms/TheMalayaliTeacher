import dotenv from 'dotenv';
import { z } from 'zod';

// Load environment variables from .env
dotenv.config({ override: true });

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(5000),

  // Storage and Queue
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  REDIS_URL: z.string().default(''),

  // Telegram Mode
  TELEGRAM_MODE: z.enum(['polling', 'webhook']).default('polling'),
  TELEGRAM_WEBHOOK_URL: z.string().default(''),

  // User limits
  MAX_DOCUMENTS_PER_USER: z.coerce.number().int().positive().default(50),
  MAX_DAILY_QUESTIONS: z.coerce.number().int().positive().default(100),
  MAX_DAILY_DOCUMENT_UPLOADS: z.coerce.number().int().positive().default(10),
  MAX_DAILY_STUDY_GENERATIONS: z.coerce.number().int().positive().default(20),

  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required').default('mongodb://localhost:27017/student-rag'),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),

  // AI Providers Selection (Gemini only)
  AI_PROVIDER: z.literal('gemini').default('gemini'),
  EMBEDDING_PROVIDER: z.literal('gemini').default('gemini'),

  // Google Gemini Configuration
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite'),
  GEMINI_EMBEDDING_MODEL: z.string().default('gemini-embedding-001'),

  // Qdrant Vector Database
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional().default(''),
  QDRANT_COLLECTION: z.string().min(1).default('student_documents'),

  // RAG & Chunking
  CHUNK_SIZE: z.coerce.number().int().positive().default(700),
  CHUNK_OVERLAP: z.coerce.number().int().nonnegative().default(100),
  TOP_K: z.coerce.number().int().positive().default(5),
  MAX_HISTORY_MESSAGES: z.coerce.number().int().positive().default(10),

  // File Upload Settings
  MAX_FILE_SIZE_MB: z.coerce.number().int().positive().default(20),
  UPLOAD_DIR: z.string().default('./data/uploads'),

  // Rate Limiting & Study Assistant Settings
  QUESTIONS_PER_MINUTE: z.coerce.number().int().positive().default(10),
  QUESTION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
  STUDY_GENERATION_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(5),
  STUDY_SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(60),

  // V3 Context Budget Limits
  MAX_SUMMARY_CONTEXT_CHUNKS: z.coerce.number().int().positive().default(20),
  MAX_QUIZ_CONTEXT_CHUNKS: z.coerce.number().int().positive().default(15),
  MAX_FLASHCARD_CONTEXT_CHUNKS: z.coerce.number().int().positive().default(15),
  MAX_EXPLAIN_CONTEXT_CHUNKS: z.coerce.number().int().positive().default(8),

  // V4 Advanced RAG & Intelligent Retrieval
  RETRIEVAL_CANDIDATES: z.coerce.number().int().positive().default(20),
  FINAL_CONTEXT_CHUNKS: z.coerce.number().int().positive().default(6),
  MAX_QUERY_EXPANSIONS: z.coerce.number().int().nonnegative().default(2),
  ENABLE_QUERY_EXPANSION: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  ENABLE_HYBRID_SEARCH: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  ENABLE_RERANKING: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  ENABLE_GROUNDING_VALIDATION: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(true),
  RAG_DEBUG: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  INDEX_VERSION: z.coerce.number().int().positive().default(2),
  SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.25),

  // V4.1 Gemini Quota Management, Retries & Cost Optimization
  GEMINI_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  GEMINI_INITIAL_RETRY_DELAY_MS: z.coerce.number().int().positive().default(1000),
  GEMINI_MAX_RETRY_DELAY_MS: z.coerce.number().int().positive().default(10000),
  GEMINI_RETRY_JITTER_MS: z.coerce.number().int().nonnegative().default(500),
  GEMINI_MAX_RETRY_TIME_MS: z.coerce.number().int().positive().default(25000),
  GEMINI_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().positive().default(2),
  GEMINI_MAX_QUEUE_SIZE: z.coerce.number().int().positive().default(20),
  MAX_GEMINI_CALLS_PER_USER_REQUEST: z.coerce.number().int().positive().default(3),
  ENABLE_GEMINI_RERANKING: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  ENABLE_GEMINI_GROUNDING_CHECK: z.preprocess((val) => val === 'true' || val === true, z.boolean()).default(false),
  GEMINI_RESPONSE_CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  MAX_SUMMARY_AI_CALLS: z.coerce.number().int().positive().default(5),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(rawEnv: Record<string, unknown> = process.env): Config {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const errorMessages = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(`Configuration validation error:\n${errorMessages}`);
  }

  return result.data;
}

export const config = loadConfig();
