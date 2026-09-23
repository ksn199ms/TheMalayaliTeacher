import { describe, it, expect } from 'vitest';
import { geminiProvider, GeminiProvider } from '../src/ai/GeminiProvider.js';
import { AIFactory } from '../src/ai/ai.factory.js';
import { geminiEmbeddingProvider, GeminiEmbeddingProvider } from '../src/embeddings/GeminiEmbeddingProvider.js';
import { EmbeddingFactory } from '../src/embeddings/embedding.service.js';
import { qdrantService } from '../src/vector/qdrant.service.js';
import { handleProviderCommand } from '../src/bot/handlers/provider.handler.js';
import { AIProviderError } from '../src/ai/AIProvider.js';

describe('Google Gemini Integration Tests', () => {
  describe('1. Provider Abstraction & Instantiation', () => {
    it('GeminiProvider should implement AIProvider interface', () => {
      expect(typeof geminiProvider.generateText).toBe('function');
      expect(typeof geminiProvider.streamText).toBe('function');
    });

    it('AIFactory should return GeminiProvider', () => {
      const provider = AIFactory.getProvider('gemini');
      expect(provider).toBeInstanceOf(GeminiProvider);
    });

    it('GeminiProvider should throw structured AIProviderError when API key is missing', async () => {
      const unconfigured = new GeminiProvider('');
      await expect(unconfigured.generateText({ prompt: 'hello' })).rejects.toThrow(AIProviderError);
    });
  });

  describe('2. Gemini Embeddings & Dimension', () => {
    it('GeminiEmbeddingProvider should have dimension 768 for gemini-embedding-001', () => {
      expect(geminiEmbeddingProvider.getDimension()).toBe(768);
    });

    it('EmbeddingFactory should return GeminiEmbeddingProvider by default', () => {
      const provider = EmbeddingFactory.getProvider('gemini');
      expect(provider).toBeInstanceOf(GeminiEmbeddingProvider);
      expect(provider.getDimension()).toBe(768);
    });

    it('GeminiEmbeddingProvider should throw error when API key is missing', async () => {
      const unconfigured = new GeminiEmbeddingProvider('');
      await expect(unconfigured.embedQuery('test')).rejects.toThrow(/GEMINI_API_KEY is not configured/);
    });
  });

  describe('3. Qdrant Vector Collection Adaptation (768 Dimensions)', () => {
    it('should ensure collection exists with 768 dimensions for Gemini', async () => {
      await qdrantService.ensureCollection(768);
      const exists = await qdrantService.getClient().collectionExists(qdrantService.getCollectionName());
      expect(exists.exists).toBe(true);

      const info = await qdrantService.getClient().getCollection(qdrantService.getCollectionName());
      const vectorSize = (info.config?.params?.vectors as any)?.size;
      expect(vectorSize).toBe(768);
    });

    it('should support upserting and searching 768-dimensional Gemini vectors with userId isolation', async () => {
      const userAId = 'gemini_user_A';
      const userBId = 'gemini_user_B';

      // 768-dim mock vectors
      const vectorA = new Array(768).fill(0.01);
      vectorA[0] = 0.9;

      const vectorB = new Array(768).fill(0.01);
      vectorB[1] = 0.9;

      // Upsert User A
      await qdrantService.upsertVectors([
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          vector: vectorA,
          payload: {
            userId: userAId,
            documentId: 'doc_gemini_A',
            fileName: 'GeminiPhysics.pdf',
            pageNumber: 1,
            chunkIndex: 0,
            text: 'Newton gravity in Gemini 768-dim space.',
          },
        },
      ]);

      // Upsert User B
      await qdrantService.upsertVectors([
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          vector: vectorA, // same vector direction to test filter
          payload: {
            userId: userBId,
            documentId: 'doc_gemini_B',
            fileName: 'GeminiHistory.pdf',
            pageNumber: 1,
            chunkIndex: 0,
            text: 'Private history document for User B.',
          },
        },
      ]);

      // Search with User A filter
      const userAResults = await qdrantService.searchVectors(vectorA, {
        userId: userAId,
        limit: 5,
      });

      expect(userAResults.length).toBeGreaterThan(0);
      for (const res of userAResults) {
        expect(res.payload.userId).toBe(userAId);
        expect(res.payload.fileName).toBe('GeminiPhysics.pdf');
      }

      // Cleanup
      await qdrantService.deleteDocumentVectors(userAId, 'doc_gemini_A');
      await qdrantService.deleteDocumentVectors(userBId, 'doc_gemini_B');
    });
  });

  describe('4. /provider Command Handler', () => {
    it('/provider should output active provider status without leaking secrets', async () => {
      let replyMessage = '';
      const mockCtx: any = {
        from: { id: 12345678 },
        reply: async (msg: string) => {
          replyMessage = msg;
        },
      };

      await handleProviderCommand(mockCtx);
      expect(replyMessage).toContain('Active System Providers');
      expect(replyMessage).toContain('Google Gemini');
      expect(replyMessage).toContain('768d');
      expect(replyMessage).not.toContain('key');
      expect(replyMessage).not.toContain('AI_KEY');
    });
  });
});
