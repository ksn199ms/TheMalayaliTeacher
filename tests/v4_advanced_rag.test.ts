import { describe, it, expect, vi } from 'vitest';
import { normalizeQuery } from '../src/rag/query/queryNormalizer.js';
import { analyzeQuery } from '../src/rag/query/queryAnalyzer.js';
import { rewriteFollowUpQuery } from '../src/rag/query/queryRewriter.js';
import { expandQuery } from '../src/rag/query/queryExpander.js';
import { localReranker } from '../src/rag/retrieval/reranker.js';
import { contextDeduplicator } from '../src/rag/context/deduplicator.js';
import { contextCompressor } from '../src/rag/context/compressor.js';
import { groundingValidator } from '../src/rag/grounding/groundingValidator.js';
import { citationBuilder } from '../src/rag/citations/citationBuilder.js';
import { hybridRetriever } from '../src/rag/retrieval/hybridRetriever.js';
import { RAGPipeline } from '../src/rag/pipeline/RAGPipeline.js';
import { AIProvider } from '../src/ai/AIProvider.js';

describe('V4 Advanced RAG & Intelligent Retrieval Test Suite', () => {
  describe('1. Query Normalization & Understanding', () => {
    it('should strip conversational pleasantries and normalize whitespace', () => {
      const raw = '  Hello, please can you explain what is recursion in programming? Thanks!  ';
      const normalized = normalizeQuery(raw);
      expect(normalized).toBe('what is recursion in programming');
    });

    it('should preserve Malayalam Unicode text cleanly during normalization', () => {
      const mlQuery = '  ഹലോ സാർ, ന്യൂട്ടന്റെ രണ്ടാം ചലന നിയമം എന്താണ്? നന്ദി. ';
      const normalized = normalizeQuery(mlQuery);
      expect(normalized).toContain('ന്യൂട്ടന്റെ രണ്ടാം ചലന നിയമം എന്താണ്');
    });

    it('should detect query intent and language accurately', () => {
      const defEn = analyzeQuery('What is polymorphic dispatch?');
      expect(defEn.intent).toBe('definition');
      expect(defEn.language).toBe('en');

      const compEn = analyzeQuery('Compare stack vs queue in data structures');
      expect(compEn.intent).toBe('comparison');
      expect(compEn.concepts).toContain('stack');
      expect(compEn.concepts).toContain('queue');

      const mlExp = analyzeQuery('ന്യൂട്ടന്റെ മൂന്നാം ചലന നിയമം വിശദീകരിക്കുക');
      expect(mlExp.intent).toBe('explanation');
      expect(mlExp.language).toBe('ml');

      const mixed = analyzeQuery('ഓപ്പറേറ്റിംഗ് സിസ്റ്റത്തിലെ ഡെഡ്‌ലോക്ക് (Deadlock) എങ്ങനെ തടയാം?');
      expect(mixed.language).toBe('mixed');
    });
  });

  describe('2. Conversational Follow-up Rewriter', () => {
    it('should rewrite follow-up questions containing pronouns using context', () => {
      const history = [
        { role: 'user' as const, content: 'What is a B-Tree?' },
        { role: 'assistant' as const, content: 'A B-Tree is a self-balancing tree data structure that maintains sorted data.' },
      ];

      const rewritten = rewriteFollowUpQuery('How does it perform insertions?', history);
      expect(rewritten.toLowerCase()).toContain('b-tree');
    });

    it('should resolve ordinal references like "the second one"', () => {
      const history = [
        { role: 'user' as const, content: 'List the main sorting algorithms.' },
        { role: 'assistant' as const, content: '1. Quick Sort\n2. Merge Sort\n3. Bubble Sort' },
      ];

      const rewritten = rewriteFollowUpQuery('Explain the second one in detail', history);
      expect(rewritten.toLowerCase()).toContain('merge sort');
    });

    it('should leave independent questions unaltered', () => {
      const history = [
        { role: 'user' as const, content: 'What is photosynthesis?' },
        { role: 'assistant' as const, content: 'Photosynthesis is the process used by plants...' },
      ];

      const independent = 'What is the speed of light in vacuum?';
      const rewritten = rewriteFollowUpQuery(independent, history);
      expect(rewritten).toBe(independent);
    });
  });

  describe('3. Controlled Query Expansion', () => {
    it('should generate bounded expansions and map Malayalam technical terms', () => {
      const analyzed = analyzeQuery('മെമ്മറി മാനേജ്മെന്റ് എന്താണ്?');
      const expanded = expandQuery('മെമ്മറി മാനേജ്മെന്റ് എന്താണ്?', analyzed, 3, true);

      expect(expanded.length).toBeGreaterThan(0);
      expect(expanded.length).toBeLessThanOrEqual(4); // original + up to 3 expansions
      // Cross-lingual mapping check
      expect(expanded.some((q) => q.toLowerCase().includes('memory management'))).toBe(true);
    });
  });

  describe('4. Multi-Factor Local Reranking', () => {
    it('should boost chunks matching exact keywords and headings', () => {
      const analyzed = analyzeQuery('Dijkstra shortest path algorithm');
      const candidates = [
        {
          text: 'This is a general computer science overview covering many historical algorithms.',
          score: 0.85,
          documentId: 'doc1',
          fileName: 'cs.pdf',
          chunkIndex: 0,
        },
        {
          text: 'Dijkstra algorithm calculates the single-source shortest path in weighted graphs using a priority queue.',
          score: 0.80,
          documentId: 'doc1',
          fileName: 'cs.pdf',
          chunkIndex: 1,
          heading: 'Graph Algorithms: Dijkstra',
        },
      ];

      const reranked = localReranker.rerank(candidates, { analyzedQuery: analyzed });
      expect(reranked[0].heading).toBe('Graph Algorithms: Dijkstra');
      expect(reranked[0].scoreBreakdown.keywordScore).toBeGreaterThan(reranked[1].scoreBreakdown.keywordScore);
    });
  });

  describe('5. Context Deduplication & Compression', () => {
    it('should filter out chunks with >80% token overlap', () => {
      const candidates = [
        {
          text: 'Newton second law states that acceleration of an object depends upon two variables: net force and mass.',
          finalScore: 0.95,
          score: 0.95,
          documentId: 'doc1',
          fileName: 'physics.pdf',
          chunkIndex: 0,
          scoreBreakdown: { vectorScore: 0.95, keywordScore: 0.9, headingScore: 0, conceptScore: 0 },
        },
        {
          text: 'Newton second law states that the acceleration of an object depends upon two variables: the net force and the mass.',
          finalScore: 0.90,
          score: 0.90,
          documentId: 'doc1',
          fileName: 'physics.pdf',
          chunkIndex: 1,
          scoreBreakdown: { vectorScore: 0.90, keywordScore: 0.9, headingScore: 0, conceptScore: 0 },
        },
      ];

      const deduplicated = contextDeduplicator.deduplicate(candidates);
      expect(deduplicated.length).toBe(1);
    });

    it('should preserve chronological reading order for sequential chunks of the same document', () => {
      const chunks = [
        {
          text: 'Part 2: Applications of integration.',
          finalScore: 0.95,
          score: 0.95,
          documentId: 'math_doc',
          fileName: 'calc.pdf',
          pageNumber: 5,
          chunkIndex: 10,
          scoreBreakdown: { vectorScore: 0.95, keywordScore: 0, headingScore: 0, conceptScore: 0 },
        },
        {
          text: 'Part 1: Basic fundamentals of integration.',
          finalScore: 0.88,
          score: 0.88,
          documentId: 'math_doc',
          fileName: 'calc.pdf',
          pageNumber: 3,
          chunkIndex: 5,
          scoreBreakdown: { vectorScore: 0.88, keywordScore: 0, headingScore: 0, conceptScore: 0 },
        },
      ];

      const compressed = contextCompressor.compress(chunks, { maxChunks: 5, preserveDocumentOrder: true });
      expect(compressed[0].chunkIndex).toBe(5);
      expect(compressed[1].chunkIndex).toBe(10);
    });
  });

  describe('6. Grounding Validation & Citations', () => {
    it('should identify ungrounded answers when context is empty', () => {
      const result = groundingValidator.validateGrounding(
        'Neptune has 14 moons and was discovered in 1846.',
        [],
        'en'
      );
      expect(result.isGrounded).toBe(false);
      expect(result.suggestedFallback).toContain('do not contain sufficient information');
    });

    it('should identify ungrounded answers in Malayalam with Malayalam fallback message', () => {
      const result = groundingValidator.validateGrounding(
        'ചൊവ്വയിലെ ഭരണാധികാരി റോബോട്ട് ആണ്.',
        [],
        'ml'
      );
      expect(result.isGrounded).toBe(false);
      expect(result.suggestedFallback).toContain('മതിയായ വിവരങ്ങൾ ലഭ്യമല്ല');
    });

    it('should validate citations against retrieved chunks', () => {
      const chunks = [
        {
          text: 'Operating system scheduling mechanisms.',
          score: 0.89,
          documentId: 'os_doc_1',
          fileName: 'OperatingSystems.pdf',
          pageNumber: 42,
          chunkIndex: 3,
        },
      ];

      const citations = citationBuilder.buildValidatedCitations(chunks, 'Operating system scheduling mechanisms.');
      expect(citations.length).toBe(1);
      expect(citations[0].fileName).toBe('OperatingSystems.pdf');
      expect(citations[0].pageNumber).toBe(42);

      const formatted = citationBuilder.formatTelegramCitations(citations);
      expect(formatted).toContain('OperatingSystems.pdf — Page 42');
    });
  });

  describe('7. End-to-End Pipeline Orchestration', () => {
    it('should execute full pipeline and return grounded answer with citations', async () => {
      const mockAI: AIProvider = {
        name: 'mock',
        defaultModel: 'mock-model',
        generateText: vi.fn().mockResolvedValue('Newton second law defines F = m * a where force equals mass times acceleration.'),
        streamText: vi.fn(),
      };

      const pipeline = new RAGPipeline(mockAI);

      const retrieveSpy = vi.spyOn(hybridRetriever, 'retrieveCandidates').mockResolvedValue([
        {
          text: 'Newton second law defines F = m * a where force equals mass times acceleration.',
          score: 0.95,
          documentId: 'doc_newton',
          fileName: 'Physics_Unit1.pdf',
          pageNumber: 12,
          chunkIndex: 1,
          heading: 'Newton Laws',
        },
      ]);

      const result = await pipeline.execute({
        userId: 'test_user_v4',
        question: 'What is Newton second law?',
        aiProvider: mockAI,
      });

      expect(result).toBeDefined();
      expect(result.answer).toContain('Newton second law defines F = m * a');
      expect(result.metadata.normalizedQuery.toLowerCase()).toBe('what is newton second law');
      expect(result.metadata.executionTimeMs).toBeGreaterThanOrEqual(0);
      expect(mockAI.generateText).toHaveBeenCalled();
      retrieveSpy.mockRestore();
    });
  });
});
