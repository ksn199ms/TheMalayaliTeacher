import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Express, Request, Response } from 'express';
import { Telegraf } from 'telegraf';
import { qdrantService } from '../vector/qdrant.service.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';
import mongoose from 'mongoose';

const log = createChildLogger('api');

export function createExpressApp(bot?: Telegraf): Express {
  const app = express();
  app.use(express.json());

  // Serve public directory statically (e.g. /public/starter.jpg)
  const rootPublic = path.resolve(process.cwd(), 'public');
  const modulePublic = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');
  app.use('/public', express.static(rootPublic));
  app.use('/public', express.static(modulePublic));

  // Telegram webhook receiver for cloud hosting
  if (bot) {
    const webhookPath = '/api/telegram-webhook';

    // Directly handle POST updates: immediately acknowledge 200 OK to Telegram so it never times out
    app.post(webhookPath, (req: Request, res: Response) => {
      // 1. Immediately acknowledge Telegram to prevent 'Read timeout expired'
      res.status(200).send('OK');

      // 2. Process update asynchronously in background
      if (req.body && typeof req.body === 'object') {
        const updateId = req.body?.update_id;
        log.info({ updateId }, 'Received Telegram update via webhook, processing asynchronously.');
        bot.handleUpdate(req.body).catch((err: any) => {
          log.error({ error: err.message, stack: err.stack, updateId }, 'Error processing Telegram update in background.');
        });
      }
    });

    app.get(webhookPath, (_req: Request, res: Response) => {
      res.json({
        ok: true,
        message: 'Telegram webhook receiver is active and listening for POST updates.',
        mode: config.TELEGRAM_MODE,
      });
    });
  }

  // Liveness & readiness probe for cloud hosting environments
  const healthHandler = async (_req: Request, res: Response) => {
    const isMongoOk = mongoose.connection.readyState === 1;
    const isQdrantOk = await qdrantService.checkHealth().catch(() => false);
    const isHealthy = isMongoOk && isQdrantOk;

    let webhookInfo: any = null;
    let botUsername: string | null = null;
    if (bot) {
      try {
        const me = await bot.telegram.getMe();
        botUsername = me.username;
        webhookInfo = await bot.telegram.getWebhookInfo();
      } catch (e: any) {
        webhookInfo = { error: e.message };
      }
    }

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'ok' : 'degraded',
      name: 'മലയാളി ടീച്ചർ (TheMalayaliTeacher)',
      mode: config.TELEGRAM_MODE === 'webhook' ? 'webhook-telegram-bot' : 'polling-telegram-bot',
      botUsername: botUsername ? `@${botUsername}` : undefined,
      timestamp: new Date().toISOString(),
      database: isMongoOk ? 'ok' : 'down',
      qdrant: isQdrantOk ? 'ok' : 'down',
      telegramWebhook: webhookInfo,
    });
  };

  app.get('/health', healthHandler);
  app.get('/ready', healthHandler);

  app.get('/', (_req: Request, res: Response) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head><title>മലയാളി ടീച്ചർ — Telegram Bot</title></head>
        <body style="font-family: system-ui, sans-serif; display: flex; align-items: center; justify-content: center; height: 90vh; margin: 0; background: #f8fafc;">
          <div style="text-align: center; max-width: 500px; padding: 2rem; background: white; border-radius: 1rem; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
            <h1 style="color: #0f172a; margin-bottom: 0.5rem;">മലയാളി ടീച്ചർ</h1>
            <p style="color: #64748b; font-size: 0.95rem; line-height: 1.5;">Personal AI Study Assistant & Teacher for Telegram</p>
            <div style="display: inline-block; padding: 0.4rem 0.8rem; background: #ecfdf5; color: #047857; border-radius: 9999px; font-weight: 600; font-size: 0.85rem; margin-top: 1rem;">
              ● Bot Active (${config.TELEGRAM_MODE})
            </div>
          </div>
        </body>
      </html>
    `);
  });

  return app;
}
