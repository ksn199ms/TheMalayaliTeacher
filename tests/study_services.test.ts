import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { ExplainService } from '../src/study/ExplainService.js';
import { SimplifyService } from '../src/study/SimplifyService.js';
import { SummaryService } from '../src/study/SummaryService.js';
import { KeypointsService } from '../src/study/KeypointsService.js';
import { QuizService } from '../src/study/QuizService.js';
import { FlashcardService } from '../src/study/FlashcardService.js';
import { AIProvider } from '../src/ai/AIProvider.js';
import { Retriever, RetrievedChunk } from '../src/rag/retriever.js';
import { ContextBuilder } from '../src/rag/context-builder.js';
import { QdrantService } from '../src/vector/qdrant.service.js';
import { DocumentService } from '../src/modules/documents/document.service.js';
import { StudySessionService } from '../src/study/StudySessionService.js';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import { DocumentModel } from '../src/database/models/Document.js';
import { User } from '../src/database/models/User.js';
import { Types } from 'mongoose';

describe('V3: Study Services Unit & Integration Tests', () => {
  const testUserId = new Types.ObjectId().toString();
  const testDocId = new Types.ObjectId().toString();

  // Mock chunks
  const mockChunks: RetrievedChunk[] = [
    {
      text: 'Normalization in relational databases is the process of organizing data to reduce redundancy and improve data integrity. 1NF eliminates duplicate columns. 2NF removes partial dependency. 3NF removes transitive dependency.',
      score: 0.92,
      documentId: testDocId,
      fileName: 'DBMS_Guide.pdf',
      pageNumber: 6,
      chunkIndex: 0,
    },
    {
      text: 'BCNF (Boyce-Codd Normal Form) is a stricter version of 3NF where every determinant must be a candidate key.',
      score: 0.88,
      documentId: testDocId,
      fileName: 'DBMS_Guide.pdf',
      pageNumber: 7,
      chunkIndex: 1,
    },
  ];

  // Mock AI Provider
  const mockAIProvider: AIProvider = {
    generateText: vi.fn(async (options) => {
      if (options.responseFormat === 'json') {
        if (options.prompt?.includes('multiple-choice')) {
          return JSON.stringify({
            questions: [
              {
                question: 'What is the primary purpose of database normalization?',
                options: [
                  'Increase data redundancy',
                  'Reduce redundancy and improve integrity',
                  'Delete unused tables',
                  'Maximize disk storage usage',
                ],
                correctAnswer: 1,
                explanation: 'Normalization organizes data to reduce redundancy.',
                pageNumber: 6,
              },
            ],
          });
        }

        if (options.prompt?.includes('flashcards')) {
          return JSON.stringify({
            flashcards: [
              {
                front: 'What is 1NF?',
                back: 'First Normal Form eliminates duplicate columns and ensures atomic values.',
                pageNumber: 6,
              },
            ],
          });
        }
      }

      if (options.systemPrompt?.includes('Tutor')) {
        return 'Imagine a messy library where books are thrown everywhere. Normalization organizes each shelf so no book is duplicated!';
      }

      if (options.systemPrompt?.includes('Synthesizer')) {
        return `📘 **DBMS_Guide.pdf — Summary**\n\n🔹 **Main Topics**\n• Database Normalization\n\n🔹 **Important Concepts**\n• 1NF, 2NF, 3NF, BCNF\n\n🔹 **Key Takeaways**\n• Eliminates redundancy and anomalies.`;
      }

      if (options.systemPrompt?.includes('takeaways')) {
        return `⭐ **Key Points**\n\n1. Normalization organizes database data.\n2. Reduces redundancy and improves integrity.\n3. 1NF, 2NF, 3NF are core normal forms.`;
      }

      return 'Normalization is the structured organization of relational tables to prevent insertion and deletion anomalies.';
    }),
    streamText: vi.fn() as any,
  };

  // Mock Retriever
  const mockRetriever: Retriever = {
    retrieve: vi.fn(async () => mockChunks),
  };

  // Mock Qdrant Service
  const mockQdrant: Partial<QdrantService> = {
    getDocumentChunks: vi.fn(async () => mockChunks),
  };

  // Mock Document Service
  const mockDocService: Partial<DocumentService> = {
    getDocumentById: vi.fn(async (userId, docId) => {
      if (userId === testUserId && docId === testDocId) {
        return {
          _id: new Types.ObjectId(testDocId),
          userId: new Types.ObjectId(testUserId),
          fileName: 'DBMS_Guide.pdf',
          status: 'ready',
          pageCount: 10,
        } as any;
      }
      return null;
    }),
  };

  beforeAll(async () => {
    await connectDatabase('mongodb://localhost:27017/student-rag-test');
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  describe('1. ExplainService', () => {
    it('should explain a concept and include citations', async () => {
      const explainService = new ExplainService(
        mockRetriever,
        new ContextBuilder(),
        mockAIProvider
      );

      const result = await explainService.explainConcept(testUserId, 'normalization');
      expect(result.explanation).toContain('Normalization');
      expect(result.explanation).toContain('DBMS_Guide.pdf');
      expect(result.citations.length).toBeGreaterThan(0);
      expect(result.language).toBe('en');
    });

    it('should detect Malayalam and request Malayalam response', async () => {
      const explainService = new ExplainService(
        mockRetriever,
        new ContextBuilder(),
        mockAIProvider
      );

      const result = await explainService.explainConcept(testUserId, 'നോർമലൈസേഷൻ എന്താണ്?');
      expect(result.language).toBe('ml');
    });
  });

  describe('2. SimplifyService', () => {
    it('should simplify a concept using analogies and citations', async () => {
      const simplifyService = new SimplifyService(
        mockRetriever,
        new ContextBuilder(),
        mockAIProvider
      );

      const result = await simplifyService.simplifyConcept(testUserId, 'normalization');
      expect(result.simplifiedText).toContain('library');
      expect(result.simplifiedText).toContain('DBMS_Guide.pdf');
      expect(result.citations.length).toBeGreaterThan(0);
    });
  });

  describe('3. SummaryService', () => {
    it('should generate a structured summary with actual page numbers', async () => {
      const summaryService = new SummaryService(
        mockQdrant as QdrantService,
        mockDocService as DocumentService,
        mockAIProvider
      );

      const result = await summaryService.summarizeDocument(testUserId, testDocId);
      expect(result.summary).toContain('Main Topics');
      expect(result.summary).toContain('Important Concepts');
      expect(result.summary).toContain('Key Takeaways');
      expect(result.summary).toContain('Pages 6–7');
      expect(result.documentName).toBe('DBMS_Guide.pdf');
    });

    it('should throw error if document ownership does not match', async () => {
      const summaryService = new SummaryService(
        mockQdrant as QdrantService,
        mockDocService as DocumentService,
        mockAIProvider
      );

      await expect(
        summaryService.summarizeDocument('wrong_user_id', testDocId)
      ).rejects.toThrow(/Document not found or access denied/);
    });
  });

  describe('4. KeypointsService', () => {
    it('should extract grounded key points from document chunks', async () => {
      const keypointsService = new KeypointsService(
        mockQdrant as QdrantService,
        mockDocService as DocumentService,
        mockAIProvider
      );

      const result = await keypointsService.extractKeypoints(testUserId, testDocId);
      expect(result.keypointsText).toContain('Key Points');
      expect(result.keypointsText).toContain('DBMS_Guide.pdf');
      expect(result.pagesCovered).toContain(6);
    });
  });

  describe('5. QuizService Generation & Validation', () => {
    it('should generate a validated quiz and create active study session', async () => {
      const quizService = new QuizService(
        mockQdrant as QdrantService,
        mockDocService as DocumentService,
        new StudySessionService(),
        mockAIProvider
      );

      const session = await quizService.generateQuiz(testUserId, testDocId, 1);
      expect(session.type).toBe('quiz');
      expect(session.status).toBe('active');
      expect(session.questions.length).toBe(1);
      expect(session.questions[0].question).toContain('normalization');
      expect(session.questions[0].options.length).toBe(4);
      expect(session.questions[0].correctAnswer).toBe(1);

      // Render Question
      const rendered = quizService.renderQuestion(session, 0);
      expect(rendered.text).toContain('Question 1/1');
      expect(rendered.text).toContain('*B.* Reduce redundancy');
    });
  });

  describe('6. FlashcardService Generation & Validation', () => {
    it('should generate validated flashcards and render front and back', async () => {
      const flashcardService = new FlashcardService(
        mockQdrant as QdrantService,
        mockDocService as DocumentService,
        new StudySessionService(),
        mockAIProvider
      );

      const session = await flashcardService.generateFlashcards(testUserId, testDocId, 1);
      expect(session.type).toBe('flashcards');
      expect(session.status).toBe('active');
      expect(session.flashcards.length).toBe(1);
      expect(session.flashcards[0].front).toBe('What is 1NF?');

      // Render front
      const renderedFront = flashcardService.renderFlashcard(session);
      expect(renderedFront.text).toContain('What is 1NF?');
      expect(renderedFront.text).toContain('Show Answer');

      // Render back
      session.showingAnswer = true;
      const renderedBack = flashcardService.renderFlashcard(session);
      expect(renderedBack.text).toContain('First Normal Form');
      expect(renderedBack.text).toContain('DBMS_Guide.pdf — Page 6');
    });
  });
});
