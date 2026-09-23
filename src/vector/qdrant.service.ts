import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('qdrant');

export interface VectorPayload {
  userId: string;
  documentId: string;
  fileName: string;
  pageNumber?: number;
  chunkIndex: number;
  text: string;
  heading?: string;
  section?: string;
  language?: string;
  indexVersion?: number;
  [key: string]: unknown;
}

export interface SearchOptions {
  userId: string;
  documentIds?: string[];
  limit?: number;
  scoreThreshold?: number;
}

export class QdrantService {
  private client: QdrantClient;
  private collectionName: string;

  constructor(url: string = config.QDRANT_URL, collectionName: string = config.QDRANT_COLLECTION) {
    this.client = new QdrantClient({ url });
    this.collectionName = collectionName;
  }

  public getClient(): QdrantClient {
    return this.client;
  }

  public getCollectionName(): string {
    return this.collectionName;
  }

  /**
   * Check if Qdrant cluster is reachable and healthy
   */
  public async checkHealth(): Promise<boolean> {
    try {
      // Test health endpoint
      const res = await fetch(`${config.QDRANT_URL}/healthz`);
      return res.ok;
    } catch (error: any) {
      log.error({ error: error.message }, 'Qdrant health check failed.');
      return false;
    }
  }

  /**
   * Ensure the collection exists with the specified vector dimensions and Cosine distance.
   * If vector dimension has changed (e.g. from 1536 to 768), recreates the collection.
   */
  public async ensureCollection(vectorSize: number = 768): Promise<void> {
    try {
      const existsResponse = await this.client.collectionExists(this.collectionName);
      let exists = existsResponse.exists;

      if (exists) {
        const info = await this.client.getCollection(this.collectionName);
        const existingVectors = info.config?.params?.vectors;
        const currentSize = typeof existingVectors === 'object' && 'size' in existingVectors ? (existingVectors as any).size : undefined;

        if (currentSize && currentSize !== vectorSize) {
          log.warn(
            { existingSize: currentSize, requiredSize: vectorSize },
            'Vector dimension mismatch detected. Recreating Qdrant collection for new embedding provider...'
          );
          await this.client.deleteCollection(this.collectionName);
          exists = false;
        }
      }

      if (!exists) {
        log.info({ collection: this.collectionName, vectorSize }, 'Creating Qdrant collection...');
        await this.client.createCollection(this.collectionName, {
          vectors: {
            size: vectorSize,
            distance: 'Cosine',
          },
        });
        log.info({ collection: this.collectionName }, 'Qdrant collection created successfully.');

        // Create payload index for userId to optimize user isolation filtering
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'userId',
          field_schema: 'keyword',
        });
        await this.client.createPayloadIndex(this.collectionName, {
          field_name: 'documentId',
          field_schema: 'keyword',
        });
        log.info({ collection: this.collectionName }, 'Payload indexes on userId and documentId created.');
      } else {
        log.info({ collection: this.collectionName, vectorSize }, 'Qdrant collection already exists with correct dimensions.');
      }
    } catch (error: any) {
      log.error({ error: error.message, collection: this.collectionName }, 'Failed to ensure Qdrant collection.');
      throw error;
    }
  }

  /**
   * Upsert vector points into Qdrant
   */
  public async upsertVectors(
    points: Array<{
      id: string;
      vector: number[];
      payload: VectorPayload;
    }>
  ): Promise<void> {
    try {
      await this.client.upsert(this.collectionName, {
        wait: true,
        points,
      });
      log.debug({ count: points.length }, 'Upserted vectors into Qdrant.');
    } catch (error: any) {
      log.error({ error: error.message, count: points.length }, 'Failed to upsert vectors into Qdrant.');
      throw error;
    }
  }

  /**
   * Search vectors strictly enforcing userId isolation
   */
  public async searchVectors(
    queryVector: number[],
    options: SearchOptions
  ): Promise<Array<{ id: string | number; score: number; payload: VectorPayload }>> {
    const { userId, documentIds, limit = config.TOP_K, scoreThreshold } = options;

    if (!userId) {
      throw new Error('Security violation: userId is required for vector search isolation.');
    }

    const mustFilters: any[] = [
      {
        key: 'userId',
        match: { value: userId },
      },
    ];

    if (documentIds && documentIds.length > 0) {
      mustFilters.push({
        key: 'documentId',
        match: { any: documentIds },
      });
    }

    const result = await this.client.query(this.collectionName, {
      query: queryVector,
      limit,
      score_threshold: scoreThreshold,
      filter: {
        must: mustFilters,
      },
      with_payload: true,
    });

    const points = result.points || [];
    return points.map((res: any) => ({
      id: res.id,
      score: res.score ?? 0,
      payload: res.payload as unknown as VectorPayload,
    }));
  }

  /**
   * Delete vectors belonging to a specific document for a user
   */
  public async deleteDocumentVectors(userId: string, documentId: string): Promise<void> {
    if (!userId || !documentId) {
      throw new Error('userId and documentId are required to delete vectors.');
    }

    await this.client.delete(this.collectionName, {
      filter: {
        must: [
          { key: 'userId', match: { value: userId } },
          { key: 'documentId', match: { value: documentId } },
        ],
      },
    });

    log.info({ userId, documentId }, 'Deleted document vectors from Qdrant.');
  }

  /**
   * Delete all vectors belonging to a user across all documents
   */
  public async deleteUserVectors(userId: string): Promise<void> {
    if (!userId) {
      throw new Error('userId is required to delete vectors.');
    }

    await this.client.delete(this.collectionName, {
      filter: {
        must: [{ key: 'userId', match: { value: userId } }],
      },
    });

    log.info({ userId }, 'Deleted all user vectors from Qdrant.');
  }

  /**
   * Retrieve sequential chunks for a specific document belonging to a user using scroll API.
   * Chunks are sorted by chunkIndex to preserve document flow.
   */
  public async getDocumentChunks(
    userId: string,
    documentId: string,
    limit: number = 50
  ): Promise<Array<{ text: string; fileName: string; pageNumber?: number; chunkIndex: number; documentId: string }>> {
    if (!userId || !documentId) {
      throw new Error('userId and documentId are required to retrieve document chunks.');
    }

    try {
      const result = await this.client.scroll(this.collectionName, {
        filter: {
          must: [
            { key: 'userId', match: { value: userId } },
            { key: 'documentId', match: { value: documentId } },
          ],
        },
        limit,
        with_payload: true,
      });

      const points = result.points || [];
      const chunks = points.map((p) => {
        const payload = p.payload as unknown as VectorPayload;
        return {
          text: payload.text,
          fileName: payload.fileName,
          pageNumber: payload.pageNumber,
          chunkIndex: payload.chunkIndex ?? 0,
          documentId: payload.documentId,
          heading: payload.heading,
          section: payload.section,
          language: payload.language,
          indexVersion: payload.indexVersion,
        };
      });

      // Sort by chunkIndex ascending
      chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
      return chunks;
    } catch (error: any) {
      log.error({ error: error.message, userId, documentId }, 'Failed to retrieve document chunks from Qdrant.');
      // If Qdrant is unreachable or down, throw so caller knows it's a service failure, not an empty document
      if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED')) {
        throw new Error(`Vector database is unreachable at ${config.QDRANT_URL}. Please ensure Qdrant is running.`);
      }
      return [];
    }
  }
}

export const qdrantService = new QdrantService();
