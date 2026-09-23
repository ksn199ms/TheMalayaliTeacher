import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import { parserRegistry } from '../src/ingestion/parsers/index.js';
import { cleanText } from '../src/ingestion/cleaner.js';
import { chunkingService } from '../src/ingestion/chunker.js';
import { contextBuilder } from '../src/rag/context-builder.js';
import { qdrantService } from '../src/vector/qdrant.service.js';
import { ingestionService } from '../src/ingestion/ingestion.service.js';
import { documentService } from '../src/modules/documents/document.service.js';
import { questionRateLimiter } from '../src/utils/rate-limiter.js';
import { DocumentModel } from '../src/database/models/Document.js';
import { User } from '../src/database/models/User.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const testArtifactsDir = path.join(__dirname, 'fixtures');

describe('Phases 2-6: Ingestion, RAG, and Security Tests', () => {
  beforeAll(async () => {
    await connectDatabase('mongodb://localhost:27017/student-rag-test');
    await fs.mkdir(testArtifactsDir, { recursive: true });
    await qdrantService.ensureCollection(768);
  });

  afterAll(async () => {
    await fs.rm(testArtifactsDir, { recursive: true, force: true });
    await User.deleteMany({ telegramId: { $in: ['user_A_id', 'user_B_id', 'test_rate_user'] } });
    await DocumentModel.deleteMany({ fileName: /test/i });
    await disconnectDatabase();
  });

  describe('1. Text Cleaner & Malayalam Support', () => {
    it('should normalize whitespace and preserve paragraphs', () => {
      const raw = '  Heading 1  \n\n\n\n  Paragraph 1 with   multiple    spaces.\n\n\nParagraph 2.  ';
      const cleaned = cleanText(raw);
      expect(cleaned).toBe('Heading 1\n\nParagraph 1 with multiple spaces.\n\nParagraph 2.');
    });

    it('should preserve Unicode and Malayalam text without corruption', () => {
      const malayalam = 'ന്യൂട്ടന്റെ രണ്ടാം ചലന നിയമം എന്താണ്? \n\nഈ വിഷയം എളുപ്പത്തിൽ വിശദീകരിക്കൂ.';
      const cleaned = cleanText(malayalam);
      expect(cleaned).toContain('ന്യൂട്ടന്റെ രണ്ടാം ചലന നിയമം എന്താണ്?');
      expect(cleaned).toContain('ഈ വിഷയം എളുപ്പത്തിൽ വിശദീകരിക്കൂ.');
    });
  });

  describe('2. Parsers Selection and Extraction', () => {
    it('should select appropriate parser by file extension', () => {
      expect(parserRegistry.getParser('physics.pdf', 'application/pdf')?.constructor.name).toBe('PdfParser');
      expect(parserRegistry.getParser('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')?.constructor.name).toBe('DocxParser');
      expect(parserRegistry.getParser('read.txt', 'text/plain')?.constructor.name).toBe('TxtParser');
      expect(parserRegistry.getParser('guide.md', 'text/markdown')?.constructor.name).toBe('MarkdownParser');
      expect(parserRegistry.getParser('unknown.xyz', 'application/octet-stream')).toBeUndefined();
    });

    it('should parse TXT and Markdown files properly', async () => {
      const txtPath = path.join(testArtifactsDir, 'test-notes.txt');
      await fs.writeFile(txtPath, 'Newton Second Law:\nForce equals mass times acceleration (F = ma).', 'utf-8');

      const txtParser = parserRegistry.getParser('test-notes.txt', 'text/plain')!;
      const parsedTxt = await txtParser.parse(txtPath);
      expect(parsedTxt.pages.length).toBe(1);
      expect(parsedTxt.pages[0].pageNumber).toBeUndefined(); // Don't invent page numbers for txt
      expect(parsedTxt.pages[0].text).toContain('Force equals mass times acceleration');

      const mdPath = path.join(testArtifactsDir, 'test-guide.md');
      await fs.writeFile(mdPath, '# Biology\n\nPhotosynthesis occurs in chloroplasts.', 'utf-8');

      const mdParser = parserRegistry.getParser('test-guide.md', 'text/markdown')!;
      const parsedMd = await mdParser.parse(mdPath);
      expect(parsedMd.pages[0].text).toContain('Photosynthesis occurs in chloroplasts');
    });
  });

  describe('3. Chunking Service', () => {
    it('should chunk text while preserving all document and page metadata', () => {
      const sampleText = 'Paragraph 1: Newton first law of motion.\n\nParagraph 2: Newton second law of motion.\n\nParagraph 3: Newton third law of motion.';
      const chunks = chunkingService.chunkText(
        sampleText,
        {
          userId: 'user_123',
          documentId: 'doc_456',
          fileName: 'physics.pdf',
          pageNumber: 5,
        },
        { chunkSize: 30, chunkOverlap: 10 }
      );

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(chunk.userId).toBe('user_123');
        expect(chunk.documentId).toBe('doc_456');
        expect(chunk.fileName).toBe('physics.pdf');
        expect(chunk.pageNumber).toBe(5);
        expect(typeof chunk.chunkIndex).toBe('number');
        expect(chunk.text.length).toBeGreaterThan(0);
      }
    });
  });

  describe('4. Context Builder & Citations', () => {
    it('should construct deduplicated citations and format them accurately', () => {
      const chunks = [
        {
          text: 'Force is mass times acceleration.',
          score: 0.89,
          documentId: 'doc_1',
          fileName: 'Physics.pdf',
          pageNumber: 24,
          chunkIndex: 0,
        },
        {
          text: 'Acceleration is proportional to net force.',
          score: 0.85,
          documentId: 'doc_1',
          fileName: 'Physics.pdf',
          pageNumber: 24, // duplicate page citation
          chunkIndex: 1,
        },
        {
          text: 'Work done is force times displacement.',
          score: 0.81,
          documentId: 'doc_1',
          fileName: 'Physics.pdf',
          pageNumber: 25,
          chunkIndex: 2,
        },
        {
          text: 'Notes from lecture.',
          score: 0.75,
          documentId: 'doc_2',
          fileName: 'ClassNotes.docx',
          pageNumber: undefined, // no page number for docx
          chunkIndex: 0,
        },
      ];

      const { contextText, citations } = contextBuilder.buildContext(chunks);

      expect(contextText).toContain('Physics.pdf (Page 24)');
      expect(contextText).toContain('ClassNotes.docx');
      expect(citations.length).toBe(3); // Physics p24, Physics p25, ClassNotes.docx

      const formatted = contextBuilder.formatCitations(citations);
      expect(formatted).toContain('• Physics.pdf — Page 24');
      expect(formatted).toContain('• Physics.pdf — Page 25');
      expect(formatted).toContain('• ClassNotes.docx');
      expect(formatted).not.toContain('undefined');
    });
  });

  describe('5. Rate Limiting', () => {
    it('should enforce question rate limits per user', () => {
      const testUserId = 'test_rate_user';
      // Limit is 10 requests per minute
      for (let i = 0; i < 10; i++) {
        expect(questionRateLimiter.isAllowed(testUserId)).toBe(true);
      }
      // 11th request should be blocked
      expect(questionRateLimiter.isAllowed(testUserId)).toBe(false);
      expect(questionRateLimiter.getRetryAfterSeconds(testUserId)).toBeGreaterThan(0);
    });
  });

  describe('6. MANDATORY SECURITY TEST: User Data Isolation', () => {
    it('User A must NEVER retrieve User B document chunks', async () => {
      const userAId = 'user_A_secure_id';
      const userBId = 'user_B_secure_id';

      // Mock embeddings with 768 dimensions
      const vectorA = new Array(768).fill(0.1);
      vectorA[0] = 1.0;

      const vectorB = new Array(768).fill(0.1);
      vectorB[1] = 1.0;

      // Upsert User A Physics points
      await qdrantService.upsertVectors([
        {
          id: '11111111-1111-1111-1111-111111111111',
          vector: vectorA,
          payload: {
            userId: userAId,
            documentId: 'doc_physics_A',
            fileName: 'Physics.pdf',
            pageNumber: 1,
            chunkIndex: 0,
            text: 'Newton laws of mechanics for User A.',
          },
        },
      ]);

      // Upsert User B History points
      await qdrantService.upsertVectors([
        {
          id: '22222222-2222-2222-2222-222222222222',
          vector: vectorA, // Even if query vector matches User B point strongly
          payload: {
            userId: userBId,
            documentId: 'doc_history_B',
            fileName: 'WorldHistory.pdf',
            pageNumber: 10,
            chunkIndex: 0,
            text: 'Confidential World War facts belonging exclusively to User B.',
          },
        },
      ]);

      // Search using vectorA with User A filter
      const userAResults = await qdrantService.searchVectors(vectorA, {
        userId: userAId,
        limit: 10,
      });

      // Verification: User A only retrieves User A's chunks
      expect(userAResults.length).toBeGreaterThan(0);
      for (const res of userAResults) {
        expect(res.payload.userId).toBe(userAId);
        expect(res.payload.text).not.toContain('User B');
        expect(res.payload.fileName).not.toBe('WorldHistory.pdf');
      }

      // Search using vectorA with User B filter
      const userBResults = await qdrantService.searchVectors(vectorA, {
        userId: userBId,
        limit: 10,
      });

      // Verification: User B only retrieves User B's chunks
      expect(userBResults.length).toBeGreaterThan(0);
      for (const res of userBResults) {
        expect(res.payload.userId).toBe(userBId);
        expect(res.payload.text).not.toContain('User A');
        expect(res.payload.fileName).toBe('WorldHistory.pdf');
      }

      // Cleanup points
      await qdrantService.deleteDocumentVectors(userAId, 'doc_physics_A');
      await qdrantService.deleteDocumentVectors(userBId, 'doc_history_B');
    });
  });

  describe('7. Duplicate File Detection & Document Deletion', () => {
    it('should detect duplicate uploads by SHA-256 for the same user', () => {
      const buffer = Buffer.from('Quantum Physics Lecture 1 Content');
      const hash1 = ingestionService.calculateHash(buffer);
      const hash2 = ingestionService.calculateHash(buffer);
      expect(hash1).toBe(hash2);
      expect(hash1.length).toBe(64);
    });
  });
});
