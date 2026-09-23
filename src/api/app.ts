import express, { Express, Request, Response } from 'express';
import { Telegraf } from 'telegraf';
import { qdrantService } from '../vector/qdrant.service.js';
import { config } from '../config/env.js';
import mongoose from 'mongoose';

export function createExpressApp(bot?: Telegraf): Express {
  const app = express();
  app.use(express.json());

  // Telegram webhook receiver for cloud hosting
  if (bot && config.TELEGRAM_MODE === 'webhook') {
    const webhookPath = '/api/telegram-webhook';
    app.use(webhookPath, bot.webhookCallback(webhookPath));
  }

  // Liveness & readiness probe for cloud hosting environments
  const healthHandler = async (_req: Request, res: Response) => {
    const isMongoOk = mongoose.connection.readyState === 1;
    const isQdrantOk = await qdrantService.checkHealth().catch(() => false);
    const isHealthy = isMongoOk && isQdrantOk;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'ok' : 'degraded',
      name: 'മലയാളി ടീച്ചർ (TheMalayaliTeacher)',
      mode: config.TELEGRAM_MODE === 'webhook' ? 'webhook-telegram-bot' : 'polling-telegram-bot',
      timestamp: new Date().toISOString(),
      database: isMongoOk ? 'ok' : 'down',
      qdrant: isQdrantOk ? 'ok' : 'down',
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
