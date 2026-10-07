import { QdrantService, qdrantService, VectorPayload } from '../../vector/qdrant.service.js';
import { EmbeddingService, embeddingService } from '../../embeddings/embedding.service.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';
import { buildRetrievalFilter } from './retrievalFilters.js';

const log = createChildLogger('hybrid.retriever');

export interface CandidateChunk {
  id?: string | number;
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

export interface HybridRetrievalOptions {
  userId: string;
  documentIds?: string[];
  candidatePoolSize?: number;
  scoreThreshold?: number;
}

export class HybridRetriever {
  private vectorService: QdrantService;
  private embeddings: EmbeddingService;

  constructor(vectorService?: QdrantService, embeddings?: EmbeddingService) {
    this.vectorService = vectorService || qdrantService;
    this.embeddings = embeddings || embeddingService;
  }

  /**
   * Retrieves a candidate pool of chunks across primary and expanded queries
   * with strict userId isolation and deduplication.
   */
  public async retrieveCandidates(
    queries: string[],
    options: HybridRetrievalOptions
  ): Promise<CandidateChunk[]> {
    const { userId, documentIds, candidatePoolSize = config.RETRIEVAL_CANDIDATES, scoreThreshold } = options;

    const validatedScope = await buildRetrievalFilter(userId, documentIds);
    if (validatedScope.hasDocuments === false) {
      log.debug({ userId: validatedScope.userId }, 'User has no ready documents; skipping vector search.');
      return [];
    }

    const validQueries = queries
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    if (validQueries.length === 0) {
      return [];
    }

    log.debug(
      {
        userId: validatedScope.userId,
        queryCount: validQueries.length,
        candidatePoolSize,
        scopedDocs: validatedScope.documentIds?.length,
      },
      'Starting candidate retrieval across queries...'
    );

    // Track candidates by key "documentId:chunkIndex"
    const candidateMap = new Map<string, CandidateChunk>();

    // Execute vector search for each query (in parallel with Promise.all)
    const searchPromises = validQueries.map(async (queryText, queryIdx) => {
      try {
        const queryVector = await this.embeddings.embedQuery(queryText);
        const matches = await this.vectorService.searchVectors(queryVector, {
          userId: validatedScope.userId,
          documentIds: validatedScope.documentIds,
          limit: candidatePoolSize,
          scoreThreshold,
        });
        return { queryText, queryIdx, matches };
      } catch (err: any) {
        log.warn({ error: err.message, queryText }, 'Vector search failed for expanded query variation.');
        return { queryText, queryIdx, matches: [] };
      }
    });

    const searchResults = await Promise.all(searchPromises);

    // Merge and deduplicate candidates using RRF and max vector score
    for (const { matches } of searchResults) {
      matches.forEach((m, rank) => {
        const payload = m.payload as VectorPayload;
        const key = `${payload.documentId}:${payload.chunkIndex}`;

        // RRF score increment: 1 / (60 + rank + 1)
        const rrfIncrement = 1 / (60 + rank + 1);

        const existing = candidateMap.get(key);
        if (existing) {
          // Keep the highest cosine similarity score, add small RRF multi-query boost
          existing.score = Math.max(existing.score, m.score) + rrfIncrement * 0.1;
        } else {
          candidateMap.set(key, {
            id: m.id,
            text: payload.text,
            score: m.score + rrfIncrement * 0.1,
            documentId: payload.documentId,
            fileName: payload.fileName,
            pageNumber: payload.pageNumber,
            chunkIndex: payload.chunkIndex,
            heading: payload.heading,
            section: payload.section,
            language: payload.language,
            indexVersion: payload.indexVersion,
          });
        }
      });
    }

    const allCandidates = Array.from(candidateMap.values());

    // Sort descending by initial retrieval score
    allCandidates.sort((a, b) => b.score - a.score);

    // Cap candidate pool to candidatePoolSize
    const candidates = allCandidates.slice(0, candidatePoolSize);

    log.debug(
      { totalUniqueCandidates: allCandidates.length, returnedCandidates: candidates.length },
      'Hybrid candidate retrieval completed.'
    );

    return candidates;
  }
}

export const hybridRetriever = new HybridRetriever();
