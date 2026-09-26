import fs from 'node:fs';
import path from 'node:path';
import { Server } from 'node:http';
import { spawn } from 'node:child_process';
import { Telegraf } from 'telegraf';
import { config } from './config/env.js';
import { logger } from './utils/logger.js';
import { connectDatabase, disconnectDatabase } from './database/connection.js';
import { qdrantService } from './vector/qdrant.service.js';
import { embeddingService } from './embeddings/embedding.service.js';
import { createBot } from './bot/bot.js';
import { createExpressApp } from './api/app.js';

export class App {
  private bot?: Telegraf;
  private expressServer?: Server;
  private isRunning: boolean = false;

  public async init(): Promise<void> {
    logger.info('Initializing TheMalayaliTeacher application...');

    // 1. Connect MongoDB
    await connectDatabase(config.MONGODB_URI);

    // 2. Connect Qdrant & ensure collection
    let isQdrantHealthy = await qdrantService.checkHealth();
    if (!isQdrantHealthy && (config.QDRANT_URL.includes('localhost') || config.QDRANT_URL.includes('127.0.0.1'))) {
      const exePath = path.resolve(process.cwd(), 'bin', 'qdrant', 'qdrant.exe');
      if (fs.existsSync(exePath)) {
        logger.info('Qdrant is not running. Automatically starting local Qdrant server...');
        const qdrantProcess = spawn(exePath, [], {
          cwd: process.cwd(),
          stdio: 'ignore',
          detached: true,
        });
        qdrantProcess.unref();

        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 500));
          if (await qdrantService.checkHealth()) {
            isQdrantHealthy = true;
            logger.info('Local Qdrant server successfully started.');
            break;
          }
        }
      }
    }

    if (!isQdrantHealthy) {
      logger.warn(
        `Qdrant is not responding at ${config.QDRANT_URL}. If running locally, start it using 'npm run qdrant:start'.`
      );
    } else {
      logger.info(`Qdrant is reachable at ${config.QDRANT_URL}.`);
      await qdrantService.ensureCollection(embeddingService.getDimension());
    }

    // 3. Initialize Telegram Bot
    const isTokenPlaceholder =
      !config.TELEGRAM_BOT_TOKEN ||
      config.TELEGRAM_BOT_TOKEN.includes('dummy') ||
      config.TELEGRAM_BOT_TOKEN.includes('replace_with');

    if (isTokenPlaceholder) {
      logger.warn(
        'TELEGRAM_BOT_TOKEN is set to a placeholder. Set a real bot token from @BotFather in .env to connect to Telegram live.'
      );
    } else {
      this.bot = createBot(config.TELEGRAM_BOT_TOKEN);
      logger.info('Telegram bot initialized.');
    }
  }

  public async start(): Promise<void> {
    await this.init();

    // 1. Start HTTP REST API Server with optional bot webhook handler
    const expressApp = createExpressApp(this.bot);
    await new Promise<void>((resolve) => {
      this.expressServer = expressApp.listen(config.PORT, () => {
        logger.info(`🚀 Unified REST API Server listening on port ${config.PORT} (http://localhost:${config.PORT})`);
        resolve();
      });
    });

    // 2. Start Telegram Bot
    if (this.bot) {
      if (config.TELEGRAM_MODE === 'webhook') {
        if (!config.TELEGRAM_WEBHOOK_URL) {
          logger.error(
            '⚠️ TELEGRAM_MODE is set to "webhook", but TELEGRAM_WEBHOOK_URL is empty! ' +
            'Set TELEGRAM_WEBHOOK_URL=https://<your-app>.onrender.com in your Render environment variables.'
          );
        } else {
          const fullWebhookUrl = `${config.TELEGRAM_WEBHOOK_URL.replace(/\/$/, '')}/api/telegram-webhook`;
          logger.info({ webhookUrl: fullWebhookUrl }, 'Registering Telegram bot webhook with Telegram API...');
          try {
            await this.bot.telegram.setWebhook(fullWebhookUrl);
            logger.info('Telegram bot webhook registered successfully!');
          } catch (webhookErr: any) {
            logger.error({ error: webhookErr.message }, 'Failed to register Telegram webhook.');
          }
        }
      } else {
        logger.info('Starting Telegram bot polling mode...');
        try {
          // Clear any conflicting webhook so Telegram routes updates to polling
          await this.bot.telegram.deleteWebhook({ drop_pending_updates: false });
          this.bot
            .launch(() => {
              logger.info('Telegram bot successfully connected and listening for updates!');
            })
            .catch((launchErr: any) => {
              logger.error(
                { error: launchErr.message },
                'Telegram bot launch error (make sure no other bot instance or npm run dev is running with this token).'
              );
            });
        } catch (pollErr: any) {
          logger.error({ error: pollErr.message }, 'Failed to start Telegram polling.');
        }
      }
    } else {
      logger.info('Application running in API-only mode (Telegram polling skipped due to placeholder token).');
    }

    this.isRunning = true;
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    logger.info('Stopping application gracefully...');

    if (this.expressServer) {
      await new Promise<void>((resolve) => {
        this.expressServer?.close(() => {
          logger.info('HTTP server closed.');
          resolve();
        });
      });
    }

    if (this.bot) {
      if (config.TELEGRAM_MODE === 'webhook') {
        try {
          await this.bot.telegram.deleteWebhook({ drop_pending_updates: false });
        } catch {}
      } else {
        this.bot.stop('SIGINT');
      }
    }

    await disconnectDatabase();
    this.isRunning = false;
    logger.info('Application stopped cleanly.');
  }
}
