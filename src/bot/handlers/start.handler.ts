import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { buildMainMenuKeyboard } from '../keyboards/keyboard.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('start.handler');

// In-memory cache for the starter image buffer and Telegram file_id
let cachedStarterBuffer: Buffer | null = null;
let cachedTelegramFileId: string | null = null;

function loadStarterImage(): Buffer | null {
  if (cachedStarterBuffer) return cachedStarterBuffer;
  const candidates = [
    path.resolve(process.cwd(), 'public', 'starter.jpg'),
    path.resolve(fileURLToPath(new URL('../../../..', import.meta.url)), 'public', 'starter.jpg'),
    path.resolve(fileURLToPath(new URL('../../..', import.meta.url)), 'public', 'starter.jpg'),
    path.resolve(process.cwd(), 'dist', 'public', 'starter.jpg'),
  ];
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedStarterBuffer = fs.readFileSync(candidate);
        log.info({ path: candidate, bytes: cachedStarterBuffer.length }, 'Loaded starter.jpg into memory.');
        return cachedStarterBuffer;
      }
    } catch {}
  }
  log.warn('Could not locate public/starter.jpg in any candidate path.');
  return null;
}

// Pre-load on startup
loadStarterImage();

export const START_MESSAGE = `👋 *Welcome to മലയാളി ടീച്ചർ!*

ഞാൻ നിങ്ങളുടെ സ്വന്തം *AI സ്റ്റഡി അസിസ്റ്റന്റ്* (AI Study Assistant).

📚 *Upload your study materials* (Supported: PDF, DOCX, TXT, Markdown, Images up to 20MB)
💬 *Ask questions* grounded in your notes (English & മലയാളം)
🧠 *Understand difficult topics* simply
📝 *Summarize notes* for quick revision
❓ *Take quizzes* with instant grading & explanations
🗂 *Practice with flashcards* to master terms
💡 *Simplify concepts* using intuitive analogies

Use the buttons below or upload a document to get started!`;

export async function handleStart(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  log.info({ userId: from.id, username: from.username }, 'User started bot.');

  try {
    await userService.getOrCreateUser({
      telegramId: from.id.toString(),
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    });

    const mainMenu = buildMainMenuKeyboard();
    const imageBuffer = loadStarterImage();

    // 1. If we have a cached Telegram file_id, send via file_id (instant, zero upload overhead)
    if (cachedTelegramFileId && typeof ctx.replyWithPhoto === 'function') {
      try {
        await ctx.replyWithPhoto(cachedTelegramFileId, {
          caption: START_MESSAGE,
          parse_mode: 'Markdown',
          ...mainMenu,
        });
        return;
      } catch (cacheErr: any) {
        log.warn({ error: cacheErr.message }, 'Failed to send with cached file_id, falling back to buffer upload.');
        cachedTelegramFileId = null;
      }
    }

    // 2. Send image buffer directly
    if (imageBuffer && typeof ctx.replyWithPhoto === 'function') {
      try {
        const sentMsg = await ctx.replyWithPhoto(
          { source: imageBuffer, filename: 'starter.jpg' },
          { caption: START_MESSAGE, parse_mode: 'Markdown', ...mainMenu }
        );
        // Cache the file_id returned by Telegram for subsequent instant replies
        if (sentMsg && 'photo' in sentMsg && Array.isArray(sentMsg.photo) && sentMsg.photo.length > 0) {
          cachedTelegramFileId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
          log.info({ fileId: cachedTelegramFileId }, 'Cached Telegram file_id for instant start photos.');
        }
        return;
      } catch (photoErr: any) {
        log.error({ error: photoErr.message }, 'Failed to reply with starter photo, falling back to text.');
      }
    }

    await ctx.reply(START_MESSAGE, { parse_mode: 'Markdown', ...mainMenu });
  } catch (error: any) {
    log.error({ error: error.message }, 'Error in /start handler.');
    await ctx.reply('👋 Welcome! Upload your study documents or use /study to get started.', buildMainMenuKeyboard());
  }
}
