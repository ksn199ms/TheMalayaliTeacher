import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadConfig, envSchema } from '../src/config/env.js';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import { userService } from '../src/modules/users/user.service.js';
import { User } from '../src/database/models/User.js';
import { qdrantService } from '../src/vector/qdrant.service.js';
import { handleStart, START_MESSAGE } from '../src/bot/handlers/start.handler.js';
import { handleHelp, HELP_MESSAGE } from '../src/bot/handlers/help.handler.js';

describe('Phase 1: Foundation Tests', () => {
  beforeAll(async () => {
    await connectDatabase('mongodb://localhost:27017/student-rag-test');
  });

  afterAll(async () => {
    await User.deleteMany({ telegramId: { $in: ['test_telegram_user_123', '99887766'] } });
    await disconnectDatabase();
  });

  describe('1. Configuration & Validation', () => {
    it('should validate valid configuration and populate defaults', () => {
      const parsed = envSchema.parse({
        TELEGRAM_BOT_TOKEN: 'mock_token_12345',
      });

      expect(parsed.TELEGRAM_BOT_TOKEN).toBe('mock_token_12345');
      expect(parsed.NODE_ENV).toBe('development');
      expect(parsed.CHUNK_SIZE).toBe(700);
      expect(parsed.CHUNK_OVERLAP).toBe(100);
      expect(parsed.TOP_K).toBe(5);
      expect(parsed.QDRANT_COLLECTION).toBe('student_documents');
    });

    it('should fail when required TELEGRAM_BOT_TOKEN is missing', () => {
      expect(() => {
        loadConfig({
          NODE_ENV: 'development',
          TELEGRAM_BOT_TOKEN: '',
        });
      }).toThrow(/Configuration validation error/);
    });
  });

  describe('2. MongoDB Connection & User Model', () => {
    it('should connect to MongoDB and upsert a user with unique telegramId', async () => {
      const user = await userService.getOrCreateUser({
        telegramId: 'test_telegram_user_123',
        username: 'student_tester',
        firstName: 'John',
        lastName: 'Doe',
      });

      expect(user).toBeDefined();
      expect(user.telegramId).toBe('test_telegram_user_123');
      expect(user.username).toBe('student_tester');

      // Verify update on subsequent upsert
      const updatedUser = await userService.getOrCreateUser({
        telegramId: 'test_telegram_user_123',
        username: 'student_tester_updated',
        firstName: 'Johnny',
      });

      expect(updatedUser.username).toBe('student_tester_updated');
      expect(updatedUser.firstName).toBe('Johnny');

      const found = await userService.findByTelegramId('test_telegram_user_123');
      expect(found).not.toBeNull();
      expect(found?.username).toBe('student_tester_updated');
    });
  });

  describe('3. Qdrant Vector Database Connection', () => {
    it('should verify local Qdrant is healthy', async () => {
      const isHealthy = await qdrantService.checkHealth();
      expect(isHealthy).toBe(true);
    });

    it('should ensure the student documents collection exists', async () => {
      await qdrantService.ensureCollection(768);
      const exists = await qdrantService.getClient().collectionExists(qdrantService.getCollectionName());
      expect(exists.exists).toBe(true);
    });
  });

  describe('4. Telegram Bot Handlers', () => {
    it('/start handler should reply with starter photo if replyWithPhoto is supported', async () => {
      let photoSource: any = null;
      let photoCaption = '';
      const mockCtx: any = {
        from: {
          id: 99887766,
          username: 'rag_student',
          first_name: 'Rag',
          last_name: 'Student',
        },
        replyWithPhoto: async (source: any, extra: any) => {
          photoSource = source;
          photoCaption = extra?.caption || '';
        },
        reply: async () => {},
      };

      await handleStart(mockCtx);
      expect(photoSource).toBeDefined();
      expect(photoCaption).toContain('മലയാളി ടീച്ചർ');
      expect(photoCaption).toContain('Supported:');
    });

    it('/start handler should fallback to text reply if replyWithPhoto is unavailable', async () => {
      let replyMessage = '';
      const mockCtx: any = {
        from: {
          id: 99887766,
          username: 'rag_student',
          first_name: 'Rag',
          last_name: 'Student',
        },
        reply: async (msg: string) => {
          replyMessage = msg;
        },
      };

      await handleStart(mockCtx);
      expect(replyMessage).toBe(START_MESSAGE);
      expect(replyMessage).toContain('മലയാളി ടീച്ചർ');
    });

    it('/help handler should return the student guide', async () => {
      let replyMessage = '';
      const mockCtx: any = {
        from: {
          id: 99887766,
        },
        reply: async (msg: string) => {
          replyMessage = msg;
        },
      };

      await handleHelp(mockCtx);
      expect(replyMessage).toBe(HELP_MESSAGE);
      expect(replyMessage).toContain('മലയാളി ടീച്ചർ — Help Guide');
      expect(replyMessage).toContain('/docs');
      expect(replyMessage).toContain('Malayalam');
    });
  });
});
