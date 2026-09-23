import { describe, it, expect, vi } from 'vitest';
import { AIFactory } from '../src/ai/ai.factory.js';
import { GeminiProvider } from '../src/ai/GeminiProvider.js';
import { ExplainService } from '../src/study/ExplainService.js';
import { SimplifyService } from '../src/study/SimplifyService.js';
import { ContextBuilder } from '../src/rag/context-builder.js';

describe('AI Provider & Study Services Tests', () => {
  const mockChunks = [
    {
      text: 'ACID stands for Atomicity, Consistency, Isolation, Durability.',
      score: 0.95,
      documentId: 'doc_123',
      fileName: 'Database_Systems.pdf',
      pageNumber: 12,
      chunkIndex: 0,
    },
  ];

  const mockRetriever = {
    retrieve: vi.fn(async () => mockChunks),
  };

  describe('1. Provider Factory Resolution', () => {
    it('should return GeminiProvider as the default and primary provider', () => {
      const provider = AIFactory.getProvider();
      expect(provider).toBeInstanceOf(GeminiProvider);
    });

    it('should return GeminiProvider when explicitly requested', () => {
      const provider = AIFactory.getProvider('gemini');
      expect(provider).toBeInstanceOf(GeminiProvider);
    });
  });

  describe('2. Study Services Function with GeminiProvider', () => {
    it('ExplainService should run with GeminiProvider mock', async () => {
      const geminiMock = new GeminiProvider('fake_key');
      vi.spyOn(geminiMock, 'generateText').mockResolvedValue('Gemini: ACID explained thoroughly.');

      const explainService = new ExplainService(
        mockRetriever as any,
        new ContextBuilder(),
        geminiMock
      );

      const result = await explainService.explainConcept('user_1', 'ACID');
      expect(result.explanation).toContain('Gemini: ACID explained thoroughly.');
      expect(result.explanation).toContain('Database_Systems.pdf — Page 12');
    });

    it('SimplifyService should run with GeminiProvider mock', async () => {
      const geminiMock = new GeminiProvider('fake_key');
      vi.spyOn(geminiMock, 'generateText').mockResolvedValue('Gemini: Imagine a bank transfer...');

      const simplifyGemini = new SimplifyService(mockRetriever as any, new ContextBuilder(), geminiMock);
      const resG = await simplifyGemini.simplifyConcept('user_1', 'ACID');

      expect(resG.simplifiedText).toContain('Gemini: Imagine a bank transfer...');
    });
  });
});
