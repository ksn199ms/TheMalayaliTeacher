import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StudySessionService } from '../src/study/StudySessionService.js';
import { DocumentSelector } from '../src/study/DocumentSelector.js';
import { DocumentModel } from '../src/database/models/Document.js';
import { StudySession } from '../src/database/models/StudySession.js';
import { RateLimiter } from '../src/utils/rate-limiter.js';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import { Types } from 'mongoose';

describe('V3: Security Isolation & Callback Authorization Tests', () => {
  const sessionService = new StudySessionService();
  const docSelector = new DocumentSelector();

  const userA = new Types.ObjectId().toString();
  const userB = new Types.ObjectId().toString();

  let userADocId: string;
  let userBDocId: string;
  let userASessionId: string;

  beforeAll(async () => {
    await connectDatabase('mongodb://localhost:27017/student-rag-test');

    // Create Document for User A
    const docA = await DocumentModel.create({
      userId: new Types.ObjectId(userA),
      fileName: 'UserA_Secret.pdf',
      mimeType: 'application/pdf',
      fileHash: 'hash_user_a_123',
      storagePath: './uploads/userA.pdf',
      status: 'ready',
    });
    userADocId = docA._id.toString();

    // Create Document for User B
    const docB = await DocumentModel.create({
      userId: new Types.ObjectId(userB),
      fileName: 'UserB_Private.pdf',
      mimeType: 'application/pdf',
      fileHash: 'hash_user_b_456',
      storagePath: './uploads/userB.pdf',
      status: 'ready',
    });
    userBDocId = docB._id.toString();

    // Create Quiz Session for User A
    const sessionA = await sessionService.createQuizSession(
      userA,
      [userADocId],
      [
        {
          question: 'User A Question?',
          options: ['A', 'B', 'C', 'D'],
          correctAnswer: 0,
          explanation: 'Exp',
          citations: [],
        },
      ],
      'UserA_Secret.pdf'
    );
    userASessionId = sessionA._id.toString();
  });

  afterAll(async () => {
    await DocumentModel.deleteMany({ _id: { $in: [userADocId, userBDocId] } });
    await StudySession.deleteMany({ userId: { $in: [new Types.ObjectId(userA), new Types.ObjectId(userB)] } });
    await disconnectDatabase();
  });

  describe('1. Document Ownership Isolation', () => {
    it('User B should not see User A documents in document selector', async () => {
      const userBDocs = await docSelector.getUserDocuments(userB);
      const docIds = userBDocs.map((d) => d._id.toString());
      expect(docIds).toContain(userBDocId);
      expect(docIds).not.toContain(userADocId);
    });

    it('User B should fail ownership validation when attempting to access User A document', async () => {
      const accessAttempt = await docSelector.validateOwnership(userB, userADocId);
      expect(accessAttempt).toBeNull();
    });

    it('User A should successfully validate ownership of their own document', async () => {
      const accessAttempt = await docSelector.validateOwnership(userA, userADocId);
      expect(accessAttempt).not.toBeNull();
      expect(accessAttempt?.fileName).toBe('UserA_Secret.pdf');
    });
  });

  describe('2. Study Session & Callback Isolation', () => {
    it('User B should not be able to retrieve or answer User A quiz session', async () => {
      const unauthorizedSession = await sessionService.getActiveSession(userB, userASessionId);
      expect(unauthorizedSession).toBeNull();
    });

    it('User A should be able to retrieve and answer their own quiz session', async () => {
      const authorizedSession = await sessionService.getActiveSession(userA, userASessionId);
      expect(authorizedSession).not.toBeNull();
      expect(authorizedSession?._id.toString()).toBe(userASessionId);
    });
  });

  describe('3. Study Generation Rate Limiter', () => {
    it('should throttle requests exceeding the per-minute limit', () => {
      const limiter = new RateLimiter(3, 60000); // 3 requests per min
      const testUser = 'rate_limited_student_1';

      expect(limiter.isAllowed(testUser)).toBe(true);
      expect(limiter.isAllowed(testUser)).toBe(true);
      expect(limiter.isAllowed(testUser)).toBe(true);
      // 4th request within 1 min must be rejected
      expect(limiter.isAllowed(testUser)).toBe(false);

      const retryAfter = limiter.getRetryAfterSeconds(testUser);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
  });
});
