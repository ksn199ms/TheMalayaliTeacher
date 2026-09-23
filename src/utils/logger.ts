import pino from 'pino';
import { config } from '../config/env.js';

const isDev = config.NODE_ENV === 'development';

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : isDev ? 'debug' : 'info',
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:yyyy-mm-dd HH:MM:ss',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  redact: {
    paths: [
      'req.headers.authorization',
      'token',
      'apiKey',
      'TELEGRAM_BOT_TOKEN',
      'GEMINI_API_KEY',
      'password',
      '*.token',
      '*.apiKey',
      'text', // Don't log full extracted/chunked document text in production
    ],
    remove: true,
  },
  base: {
    env: config.NODE_ENV,
  },
});

export interface LogContext {
  userId?: string;
  documentId?: string;
  chatId?: string;
  operation?: string;
  durationMs?: number;
  status?: 'started' | 'success' | 'failed';
  error?: string;
  [key: string]: unknown;
}

export function createChildLogger(moduleName: string, defaultContext?: LogContext) {
  return logger.child({ module: moduleName, ...defaultContext });
}
