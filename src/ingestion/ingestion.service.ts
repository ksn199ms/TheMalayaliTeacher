import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { DocumentModel, IDocument } from '../database/models/Document.js';
import { parserRegistry } from './parsers/index.js';
import { cleanText } from './cleaner.js';
import { chunkingService, DocumentChunk } from './chunker.js';
import { embeddingService } from '../embeddings/embedding.service.js';
import { qdrantService } from '../vector/qdrant.service.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('ingestion.service');

export interface IngestionResult {
  success: boolean;
  document?: IDocument;
  isDuplicate?: boolean;
  error?: string;
}

export interface IngestionInput {
  userId: string;
  telegramFileId?: string;
  fileName: string;
  mimeType: string;
  fileBuffer: Buffer;
}

export function detectDocLanguage(sampleText: string): 'en' | 'ml' | 'mixed' {
  if (!sampleText) return 'en';
  const malayalamChars = (sampleText.match(/[\u0D00-\u0D7F]/g) || []).length;
  const englishChars = (sampleText.match(/[a-zA-Z]/g) || []).length;
  if (malayalamChars > 15 && englishChars > 15) return 'mixed';
  if (malayalamChars > 15) return 'ml';
  return 'en';
}

export class IngestionService {
  private uploadDir: string;
  private maxFileSizeBytes: number;

  constructor(
    uploadDir: string = config.UPLOAD_DIR,
    maxFileSizeMb: number = config.MAX_FILE_SIZE_MB
  ) {
    this.uploadDir = uploadDir;
    this.maxFileSizeBytes = maxFileSizeMb * 1024 * 1024;
  }

  /**
   * Calculates SHA-256 hash of file buffer
   */
  public calculateHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Ingests a study material file (PDF, DOCX, TXT, MD)
   */
  public async processDocument(input: IngestionInput): Promise<IngestionResult> {
    const { userId, telegramFileId, fileName, mimeType, fileBuffer } = input;
    const sanitizedFileName = path.basename(fileName).replace(/[^a-zA-Z0-9._\- ]/g, '_');

    log.info({ userId, fileName: sanitizedFileName, size: fileBuffer.length }, 'Starting document ingestion...');

    // 1. File size validation
    if (fileBuffer.length > this.maxFileSizeBytes) {
      log.warn({ userId, size: fileBuffer.length }, 'File size exceeded limit.');
      return {
        success: false,
        error: `File size exceeds the maximum limit of ${config.MAX_FILE_SIZE_MB}MB.`,
      };
    }

    if (fileBuffer.length === 0) {
      return {
        success: false,
        error: 'The uploaded file is empty.',
      };
    }

    // 2. Parser support check
    const parser = parserRegistry.getParser(sanitizedFileName, mimeType);
    if (!parser) {
      log.warn({ fileName: sanitizedFileName, mimeType }, 'Unsupported file format.');
      return {
        success: false,
        error: `Unsupported file format. Please upload PDF, DOCX, TXT, Markdown, or Image files (PNG, JPG, WEBP).`,
      };
    }

    // 3. Duplicate check via SHA-256
    const fileHash = this.calculateHash(fileBuffer);
    const existingDoc = await DocumentModel.findOne({
      userId: new Types.ObjectId(userId),
      fileHash,
      status: 'ready',
    });

    if (existingDoc) {
      log.info({ userId, fileHash, fileName: existingDoc.fileName }, 'Duplicate document detected for user.');
      return {
        success: false,
        isDuplicate: true,
        document: existingDoc,
      };
    }

    // 4. Create document record in MongoDB with 'processing' status
    const docId = new Types.ObjectId();
    const storageFolder = path.join(this.uploadDir, userId, docId.toString());
    const storagePath = path.join(storageFolder, 'original-file');

    let docRecord = await DocumentModel.create({
      _id: docId,
      userId: new Types.ObjectId(userId),
      telegramFileId,
      fileName: sanitizedFileName,
      mimeType,
      fileSize: fileBuffer.length,
      fileHash,
      storagePath,
      status: 'processing',
    });

    try {
      // 5. Store file safely to disk
      await fs.mkdir(storageFolder, { recursive: true });
      await fs.writeFile(storagePath, fileBuffer);

      // 6. Parse document
      log.debug({ docId: docId.toString() }, 'Parsing document content...');
      const parsedDoc = await parser.parse(storagePath, sanitizedFileName);

      // 7. Detect document language and clean/chunk pages
      const fullTextSample = parsedDoc.pages.map((p) => p.text).join(' ').slice(0, 5000);
      const docLanguage = detectDocLanguage(fullTextSample);

      const allChunks: DocumentChunk[] = [];
      for (const page of parsedDoc.pages) {
        const cleaned = cleanText(page.text);
        if (!cleaned) continue;

        const chunks = chunkingService.chunkText(cleaned, {
          userId,
          documentId: docId.toString(),
          fileName: sanitizedFileName,
          pageNumber: page.pageNumber,
          language: docLanguage,
          indexVersion: config.INDEX_VERSION,
        });

        allChunks.push(...chunks);
      }

      if (allChunks.length === 0) {
        throw new Error('No readable text could be extracted from this document.');
      }

      log.info({ docId: docId.toString(), chunkCount: allChunks.length, language: docLanguage }, 'Chunked document successfully.');

      // 8. Generate embeddings in batches of 50
      log.debug({ chunkCount: allChunks.length }, 'Generating embeddings for chunks...');
      const textsToEmbed = allChunks.map((c) => c.text);
      const batchSize = 50;
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < textsToEmbed.length; i += batchSize) {
        const batch = textsToEmbed.slice(i, i + batchSize);
        const embeddings = await embeddingService.embedDocuments(batch);
        allEmbeddings.push(...embeddings);
      }

      // 9. Store vectors in Qdrant with V4 metadata
      log.debug('Upserting vectors into Qdrant...');
      const points = allChunks.map((chunk, idx) => ({
        id: crypto.randomUUID(),
        vector: allEmbeddings[idx],
        payload: {
          userId,
          documentId: docId.toString(),
          fileName: sanitizedFileName,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          heading: chunk.heading,
          section: chunk.section,
          language: docLanguage,
          indexVersion: config.INDEX_VERSION,
        },
      }));

      await qdrantService.upsertVectors(points);

      // 10. Update MongoDB document status to READY with V4 metadata
      docRecord.status = 'ready';
      docRecord.pageCount = parsedDoc.pages.length;
      docRecord.language = docLanguage;
      docRecord.indexVersion = config.INDEX_VERSION;
      await docRecord.save();

      log.info({ docId: docId.toString(), fileName: sanitizedFileName }, 'Document ingestion completed successfully.');

      return {
        success: true,
        document: docRecord,
      };
    } catch (error: any) {
      log.error({ error: error.message, docId: docId.toString() }, 'Document ingestion failed.');

      // Mark document as failed
      docRecord.status = 'failed';
      docRecord.error = error.message;
      await docRecord.save();

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Ingests plain text notes explicitly submitted by a student
   */
  public async processPlainText(userId: string, text: string, title?: string): Promise<IngestionResult> {
    const cleaned = cleanText(text);
    if (!cleaned) {
      return { success: false, error: 'Cannot save empty text notes.' };
    }

    const fileName = title ? `${title.replace(/[^a-zA-Z0-9_\-]/g, '_')}.txt` : `Note-${Date.now()}.txt`;
    const buffer = Buffer.from(cleaned, 'utf-8');

    return this.processDocument({
      userId,
      fileName,
      mimeType: 'text/plain',
      fileBuffer: buffer,
    });
  }

  /**
   * Re-index an existing document from its on-disk storage file into Qdrant.
   * Useful for automatic recovery when vector dimensions change or collections are rebuilt.
   */
  public async reindexDocument(doc: IDocument): Promise<boolean> {
    try {
      if (!doc.storagePath) return false;
      const fileExists = await fs.stat(doc.storagePath).then(() => true).catch(() => false);
      if (!fileExists) return false;

      log.info({ docId: doc._id.toString(), fileName: doc.fileName }, 'Self-healing: Re-indexing document from disk storage...');
      const parser = parserRegistry.getParser(doc.fileName, doc.mimeType);
      if (!parser) return false;

      const parsedDoc = await parser.parse(doc.storagePath, doc.fileName);
      const fullTextSample = parsedDoc.pages.map((p) => p.text).join(' ').slice(0, 5000);
      const docLanguage = detectDocLanguage(fullTextSample);

      const allChunks: DocumentChunk[] = [];
      for (const page of parsedDoc.pages) {
        const cleaned = cleanText(page.text);
        if (!cleaned) continue;

        const chunks = chunkingService.chunkText(cleaned, {
          userId: doc.userId.toString(),
          documentId: doc._id.toString(),
          fileName: doc.fileName,
          pageNumber: page.pageNumber,
          language: docLanguage,
          indexVersion: config.INDEX_VERSION,
        });

        allChunks.push(...chunks);
      }

      if (allChunks.length === 0) return false;

      const textsToEmbed = allChunks.map((c) => c.text);
      const batchSize = 50;
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < textsToEmbed.length; i += batchSize) {
        const batch = textsToEmbed.slice(i, i + batchSize);
        const embeddings = await embeddingService.embedDocuments(batch);
        allEmbeddings.push(...embeddings);
      }

      const points = allChunks.map((chunk, idx) => ({
        id: crypto.randomUUID(),
        vector: allEmbeddings[idx],
        payload: {
          userId: doc.userId.toString(),
          documentId: doc._id.toString(),
          fileName: doc.fileName,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          text: chunk.text,
          heading: chunk.heading,
          section: chunk.section,
          language: docLanguage,
          indexVersion: config.INDEX_VERSION,
        },
      }));

      await qdrantService.upsertVectors(points);
      doc.status = 'ready';
      doc.pageCount = parsedDoc.pages.length;
      doc.language = docLanguage;
      doc.indexVersion = config.INDEX_VERSION;
      doc.error = undefined;
      await doc.save();
      log.info({ docId: doc._id.toString(), chunks: allChunks.length }, 'Document re-indexing completed successfully.');
      return true;
    } catch (err: any) {
      log.error({ error: err.message, docId: doc._id.toString() }, 'Failed to re-index document.');
      return false;
    }
  }
}

export const ingestionService = new IngestionService();
