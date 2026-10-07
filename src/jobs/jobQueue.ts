import crypto from 'node:crypto';
import { Types } from 'mongoose';
import { ProcessingJob, IProcessingJob } from '../database/models/ProcessingJob.js';
import { DocumentModel } from '../database/models/Document.js';
import { StorageFactory } from '../storage/StorageProvider.js';
import { parserRegistry } from '../ingestion/parsers/index.js';
import { cleanText } from '../ingestion/cleaner.js';
import { chunkingService } from '../ingestion/chunker.js';
import { embeddingService } from '../embeddings/embedding.service.js';
import { qdrantService } from '../vector/qdrant.service.js';
import { detectDocLanguage } from '../ingestion/ingestion.service.js';
import { quotaService } from '../modules/users/quota.service.js';
import { escapeHtml } from '../utils/telegram.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('job.queue');

export interface TelegramNotifier {
  telegram: any;
  chatId: number | string;
  statusMessageId?: number;
}

export interface IngestionJobData {
  jobId: string;
  userId: string;
  documentId: string;
  storageKey: string;
  fileName: string;
  mimeType: string;
  notifier?: TelegramNotifier;
}

export class JobQueue {
  private inMemoryQueue: IngestionJobData[] = [];
  private isProcessing: boolean = false;

  private async notifyTelegram(notifier?: TelegramNotifier, htmlMessage?: string): Promise<void> {
    if (!notifier || !htmlMessage) return;
    try {
      if (notifier.statusMessageId) {
        await notifier.telegram.editMessageText(
          notifier.chatId,
          notifier.statusMessageId,
          undefined,
          htmlMessage,
          { parse_mode: 'HTML' }
        );
      } else {
        await notifier.telegram.sendMessage(notifier.chatId, htmlMessage, { parse_mode: 'HTML' });
      }
    } catch (err: any) {
      log.debug({ error: err.message }, 'Could not update Telegram status message.');
    }
  }

  /**
   * Enqueues an ingestion job asynchronously and returns the persistent job record.
   */
  public async addIngestionJob(
    params: {
      userId: string;
      documentId: string;
      storageKey: string;
      fileName: string;
      mimeType: string;
    },
    notifier?: TelegramNotifier
  ): Promise<IProcessingJob> {
    const job = await ProcessingJob.create({
      userId: new Types.ObjectId(params.userId),
      documentId: new Types.ObjectId(params.documentId),
      jobType: 'ingestion',
      status: 'queued',
      stage: 'Queued for processing',
      progress: 5,
    });

    const jobData: IngestionJobData = {
      jobId: job._id.toString(),
      ...params,
      notifier,
    };

    // Push to in-memory async processing queue
    this.inMemoryQueue.push(jobData);
    log.info({ jobId: jobData.jobId, documentId: params.documentId }, 'Ingestion job enqueued.');

    // Trigger processing tick
    setImmediate(() => this.processNextJob());

    return job;
  }

  private async processNextJob(): Promise<void> {
    if (this.isProcessing || this.inMemoryQueue.length === 0) {
      return;
    }

    this.isProcessing = true;
    const currentJob = this.inMemoryQueue.shift();

    if (!currentJob) {
      this.isProcessing = false;
      return;
    }

    try {
      await this.executeIngestion(currentJob);
    } catch (err: any) {
      log.error({ jobId: currentJob.jobId, error: err.message }, 'Job execution encountered error.');
    } finally {
      this.isProcessing = false;
      if (this.inMemoryQueue.length > 0) {
        setImmediate(() => this.processNextJob());
      }
    }
  }

  private async executeIngestion(jobData: IngestionJobData): Promise<void> {
    const { jobId, userId, documentId, storageKey, fileName, mimeType, notifier } = jobData;
    log.info({ jobId, documentId }, 'Starting background ingestion execution...');

    const storage = StorageFactory.getProvider();

    // 1. Update job to processing
    await ProcessingJob.findByIdAndUpdate(jobId, {
      status: 'processing',
      stage: 'Extracting text from document',
      progress: 20,
      $inc: { attempts: 1 },
    });

    await DocumentModel.findByIdAndUpdate(documentId, {
      status: 'processing',
      processingJobId: jobId,
    });

    await this.notifyTelegram(
      notifier,
      `📥 <b>${escapeHtml(fileName)}</b>\n\n🔍 <i>Extracting text & notes with Gemini OCR... (20%)</i>`
    );

    try {
      // 2. Parser check
      const parser = parserRegistry.getParser(fileName, mimeType);
      if (!parser) {
        throw new Error(`Unsupported document type for file "${fileName}".`);
      }

      // 3. Get storage file path
      const absPath = storage.getAbsolutePath ? storage.getAbsolutePath(storageKey) : '';

      // 4. Parse content
      const parsedDoc = await parser.parse(absPath, fileName);

      await ProcessingJob.findByIdAndUpdate(jobId, {
        stage: 'Cleaning and chunking content',
        progress: 50,
      });

      await this.notifyTelegram(
        notifier,
        `📥 <b>${escapeHtml(fileName)}</b>\n\n✂️ <i>Structuring and chunking pages... (50%)</i>`
      );

      // 5. Detect language and chunk
      const fullTextSample = parsedDoc.pages.map((p) => p.text).join(' ').slice(0, 5000);
      const docLanguage = detectDocLanguage(fullTextSample);

      const allChunks: any[] = [];
      for (const page of parsedDoc.pages) {
        const cleaned = cleanText(page.text);
        if (!cleaned) continue;

        const chunks = chunkingService.chunkText(cleaned, {
          userId,
          documentId,
          fileName,
          pageNumber: page.pageNumber,
          language: docLanguage,
          indexVersion: config.INDEX_VERSION,
        });
        allChunks.push(...chunks);
      }

      if (allChunks.length === 0) {
        throw new Error('No readable text could be extracted from this document.');
      }

      await ProcessingJob.findByIdAndUpdate(jobId, {
        stage: 'Generating AI embeddings & indexing',
        progress: 75,
      });

      await this.notifyTelegram(
        notifier,
        `📥 <b>${escapeHtml(fileName)}</b>\n\n🧠 <i>Generating AI embeddings & vector indexing... (75%)</i>`
      );

      // 6. Generate Embeddings & Upsert to Qdrant
      const chunkTexts = allChunks.map((c) => c.text);
      const batchSize = 50;
      const allEmbeddings: number[][] = [];

      for (let i = 0; i < chunkTexts.length; i += batchSize) {
        const batch = chunkTexts.slice(i, i + batchSize);
        const embeddings = await embeddingService.embedDocuments(batch);
        allEmbeddings.push(...embeddings);
      }

      const qdrantPoints = allChunks.map((chunk, idx) => ({
        id: crypto.randomUUID(),
        vector: allEmbeddings[idx],
        payload: {
          userId,
          documentId,
          fileName,
          text: chunk.text,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
          tokenCount: chunk.tokenCount,
          language: docLanguage,
          heading: chunk.heading,
          section: chunk.section,
          indexVersion: config.INDEX_VERSION,
        },
      }));

      await qdrantService.upsertVectors(qdrantPoints);

      // 7. Mark Document and Job as ready / completed
      const pageCount = parsedDoc.pages.length || 1;
      await DocumentModel.findByIdAndUpdate(documentId, {
        status: 'ready',
        pageCount,
        language: docLanguage,
        indexVersion: config.INDEX_VERSION,
        error: undefined,
      });

      // Increment user daily upload quota
      await quotaService.incrementUploadCount(userId);

      await this.notifyTelegram(
        notifier,
        `✅ <b>${escapeHtml(fileName)}</b> is ready!\n\nYou can now ask questions about it or use /study to test yourself.`
      );

      await ProcessingJob.findByIdAndUpdate(jobId, {
        status: 'completed',
        stage: 'Ready',
        progress: 100,
        result: {
          chunksCount: allChunks.length,
          pageCount,
        },
      });

      log.info({ jobId, documentId, chunks: allChunks.length }, 'Document successfully indexed in background.');
    } catch (error: any) {
      log.error({ jobId, documentId, error: error.message }, 'Document processing failed in background.');

      await DocumentModel.findByIdAndUpdate(documentId, {
        status: 'failed',
        error: error.message,
      });

      await ProcessingJob.findByIdAndUpdate(jobId, {
        status: 'failed',
        stage: 'Failed',
        error: error.message,
      });

      let userFriendlyReason = 'Please check that the file is valid and try again.';
      const err = error.message?.toLowerCase() || '';
      if (err.includes('credits') || err.includes('429') || err.includes('quota') || err.includes('resource_exhausted')) {
        userFriendlyReason = 'Gemini API quota or rate limit exceeded. Please try again in a few moments.';
      } else if (err.includes('no readable text') || err.includes('blank') || err.includes('unreadable')) {
        userFriendlyReason = 'Could not detect readable text in this document or image.';
      }

      await this.notifyTelegram(
        notifier,
        `❌ I couldn't process <b>${escapeHtml(fileName)}</b>.\n\n${escapeHtml(userFriendlyReason)}`
      );
    }
  }

  public async getJobStatus(jobId: string): Promise<IProcessingJob | null> {
    return await ProcessingJob.findById(jobId);
  }

  public getQueueLength(): number {
    return this.inMemoryQueue.length;
  }
}

export const jobQueue = new JobQueue();
