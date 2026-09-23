import { QdrantService, qdrantService } from '../vector/qdrant.service.js';
import { EmbeddingService, embeddingService } from '../embeddings/embedding.service.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('retriever');

export interface RetrievalOptions {
  userId: string;
  documentIds?: string[];
  topK?: number;
  scoreThreshold?: number;
}

export interface RetrievedChunk {
  text: string;
  score: number;
  documentId: string;
  fileName: string;
  pageNumber?: number;
  chunkIndex: number;
  heading?: string;
  section?: string;
  language?: string;
  indexVersion?: number;
}

export interface Retriever {
  retrieve(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]>;
}

export class QdrantRetriever implements Retriever {
  private vectorService: QdrantService;
  private embeddings: EmbeddingService;

  constructor(vectorService?: QdrantService, embeddings?: EmbeddingService) {
    this.vectorService = vectorService || qdrantService;
    this.embeddings = embeddings || embeddingService;
  }

  public async retrieve(query: string, options: RetrievalOptions): Promise<RetrievedChunk[]> {
    if (!options.userId) {
      throw new Error('Security isolation violation: userId is required for chunk retrieval.');
    }

    const limit = options.topK ?? config.TOP_K;

    log.debug({ userId: options.userId, limit }, 'Retrieving chunks for query...');

    // 1. Generate query embedding
    const queryVector = await this.embeddings.embedQuery(query);

    // 2. Search Qdrant with mandatory userId filter
    const matches = await this.vectorService.searchVectors(queryVector, {
      userId: options.userId,
      documentIds: options.documentIds,
      limit,
      scoreThreshold: options.scoreThreshold,
    });

    return matches.map((m) => ({
      text: m.payload.text,
      score: m.score,
      documentId: m.payload.documentId,
      fileName: m.payload.fileName,
      pageNumber: m.payload.pageNumber,
      chunkIndex: m.payload.chunkIndex,
      heading: m.payload.heading,
      section: m.payload.section,
      language: m.payload.language,
      indexVersion: m.payload.indexVersion,
    }));
  }
}

export const retriever = new QdrantRetriever();
export { hybridRetriever, type CandidateChunk } from './retrieval/hybridRetriever.js';
export { localReranker, type ScoredChunk } from './retrieval/reranker.js';

