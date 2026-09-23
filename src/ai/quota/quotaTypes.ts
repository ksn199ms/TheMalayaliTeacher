export type GeminiRequestType =
  | 'answer'
  | 'summary'
  | 'explain'
  | 'keypoints'
  | 'simplify'
  | 'quiz'
  | 'flashcards'
  | 'query-expansion'
  | 'reranking'
  | 'grounding'
  | 'ocr'
  | 'embedding';

export type RequestPriority = 'HIGH' | 'MEDIUM' | 'LOW';

export type GeminiCircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface GeminiQuotaStatus {
  circuitState: GeminiCircuitState;
  openedAt?: number;
  openReason?: string;
  estimatedResetTime?: string;
  concurrency: {
    active: number;
    max: number;
    queued: number;
  };
  observedToday: {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    retriesCount: number;
  };
}
