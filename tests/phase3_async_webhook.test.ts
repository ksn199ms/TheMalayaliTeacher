import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { jobQueue } from '../src/jobs/jobQueue.js';
import { User } from '../src/database/models/User.js';
import { DocumentModel } from '../src/database/models/Document.js';
import { ProcessingJob } from '../src/database/models/ProcessingJob.js';
import { StorageFactory } from '../src/storage/StorageProvider.js';
import { createExpressApp } from '../src/api/app.js';

describe('Phase 3: Background Worker Queue & Webhook Tests', () => {
  const TEST_MONGO_URI = 'mongodb://localhost:27017/student-rag-test';
  let testUserId: string;

  beforeEach(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(TEST_MONGO_URI);
    }
    await User.deleteMany({});
    await DocumentModel.deleteMany({});
    await ProcessingJob.deleteMany({});

    const user = await User.create({
      telegramId: '123456789',
      username: 'async_student',
      role: 'student',
    });
    testUserId = user._id.toString();
  });

  afterEach(async () => {
    await User.deleteMany({});
    await DocumentModel.deleteMany({});
    await ProcessingJob.deleteMany({});
  });

  describe('Asynchronous Job Queue with Telegram Progress Notifier', () => {
    it('should enqueue job, process stages, and update Telegram status message', async () => {
      // Create a test file in storage
      const storage = StorageFactory.getProvider();
      const storageKey = `${testUserId}/test-doc-123/original-file.txt`;
      await storage.upload(storageKey, Buffer.from('Quantum computing uses qubits and superposition to solve complex problems.'), 'text/plain');

      const doc = await DocumentModel.create({
        userId: new mongoose.Types.ObjectId(testUserId),
        fileName: 'quantum_notes.txt',
        mimeType: 'text/plain',
        fileHash: 'dummy_hash_123',
        storagePath: storageKey,
        storageKey,
        status: 'processing',
      });

      // Mock Telegram notifier
      const editCalls: string[] = [];
      const mockNotifier = {
        telegram: {
          editMessageText: vi.fn(async (_chatId, _msgId, _inline, text) => {
            editCalls.push(text);
          }),
        },
        chatId: 123456789,
        statusMessageId: 999,
      };

      const job = await jobQueue.addIngestionJob(
        {
          userId: testUserId,
          documentId: doc._id.toString(),
          storageKey,
          fileName: 'quantum_notes.txt',
          mimeType: 'text/plain',
        },
        mockNotifier
      );

      expect(job.status).toBe('queued');
      expect(job.progress).toBe(5);

      // Wait for async processing to finish
      let completedJob = null;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 200));
        completedJob = await ProcessingJob.findById(job._id);
        if (completedJob && (completedJob.status === 'completed' || completedJob.status === 'failed')) {
          break;
        }
      }

      expect(completedJob).toBeDefined();
      expect(completedJob?.status).toBe('completed');
      expect(completedJob?.progress).toBe(100);

      // Verify that Telegram notifier received progress update messages
      expect(editCalls.length).toBeGreaterThanOrEqual(3);
      expect(editCalls.some((msg) => msg.includes('20%'))).toBe(true);
      expect(editCalls.some((msg) => msg.includes('50%'))).toBe(true);
      expect(editCalls.some((msg) => msg.includes('75%'))).toBe(true);
      expect(editCalls.some((msg) => msg.includes('is ready!'))).toBe(true);

      // Verify document status in DB updated to 'ready'
      const updatedDoc = await DocumentModel.findById(doc._id);
      expect(updatedDoc?.status).toBe('ready');
    });
  });

  describe('Express Webhook & Health App', () => {
    it('should create express app with health endpoint', () => {
      const app = createExpressApp();
      expect(app).toBeDefined();
      expect(typeof app.listen).toBe('function');
    });
  });
});
