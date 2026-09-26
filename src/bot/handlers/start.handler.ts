import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { buildMainMenuKeyboard } from '../keyboards/keyboard.js';
import { createChildLogger } from '../../utils/logger.js';
import { config } from '../../config/env.js';

const log = createChildLogger('start.handler');

// In-memory cache for the starter image buffer and Telegram file_id
let cachedStarterBuffer: Buffer | null = null;
let cachedTelegramFileId: string | null = null;

function loadStarterImage(): Buffer | null {
  if (cachedStarterBuffer) return cachedStarterBuffer;
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), 'public', 'starter.jpg'),
    path.resolve(currentDir, '../../public/starter.jpg'),
    path.resolve(currentDir, '../../../public/starter.jpg'),
    path.resolve(currentDir, '../../../../public/starter.jpg'),
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
  log.warn('Could not locate public/starter.jpg on disk.');
  return null;
}

// Pre-load on startup
loadStarterImage();

export const START_MESSAGE_HTML = `👋 <b>Welcome to മലയാളി ടീച്ചർ!</b>

ഞാൻ നിങ്ങളുടെ സ്വന്തം <b>AI സ്റ്റഡി അസിസ്റ്റന്റ്</b> (AI Study Assistant).

📚 <b>Upload your study materials</b> (Supported: PDF, DOCX, TXT, Markdown, Images up to 20MB)
💬 <b>Ask questions</b> grounded in your notes (English &amp; മലയാളം)
🧠 <b>Understand difficult topics</b> simply
📝 <b>Summarize notes</b> for quick revision
❓ <b>Take quizzes</b> with instant grading &amp; explanations
🗂 <b>Practice with flashcards</b> to master terms
💡 <b>Simplify concepts</b> using intuitive analogies

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
    const publicPhotoUrl = config.TELEGRAM_WEBHOOK_URL
      ? `${config.TELEGRAM_WEBHOOK_URL.replace(/\/$/, '')}/public/starter.jpg`
      : null;

    // Strategy 1: Cached Telegram file_id (ultra-fast, zero upload overhead)
    if (cachedTelegramFileId && typeof ctx.replyWithPhoto === 'function') {
      try {
        await ctx.replyWithPhoto(cachedTelegramFileId, {
          caption: START_MESSAGE_HTML,
          parse_mode: 'HTML',
          ...mainMenu,
        });
        return;
      } catch (cacheErr: any) {
        log.warn({ error: cacheErr.message }, 'Failed sending with cached file_id, falling back to buffer upload.');
        cachedTelegramFileId = null;
      }
    }

    // Strategy 2: In-memory Buffer upload
    if (imageBuffer && typeof ctx.replyWithPhoto === 'function') {
      try {
        const sentMsg = await ctx.replyWithPhoto(
          { source: imageBuffer, filename: 'starter.jpg' },
          { caption: START_MESSAGE_HTML, parse_mode: 'HTML', ...mainMenu }
        );
        if (sentMsg && 'photo' in sentMsg && Array.isArray(sentMsg.photo) && sentMsg.photo.length > 0) {
          cachedTelegramFileId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
          log.info({ fileId: cachedTelegramFileId }, 'Cached Telegram file_id for instant start photos.');
        }
        return;
      } catch (photoErr: any) {
        log.error({ error: photoErr.message }, 'Failed replying with starter photo buffer, falling back to public URL.');
      }
    }

    // Strategy 3: Public HTTPS URL (Telegram downloads directly from Render public static route)
    if (publicPhotoUrl && typeof ctx.replyWithPhoto === 'function') {
      try {
        const sentMsg = await ctx.replyWithPhoto(publicPhotoUrl, {
          caption: START_MESSAGE_HTML,
          parse_mode: 'HTML',
          ...mainMenu,
        });
        if (sentMsg && 'photo' in sentMsg && Array.isArray(sentMsg.photo) && sentMsg.photo.length > 0) {
          cachedTelegramFileId = sentMsg.photo[sentMsg.photo.length - 1].file_id;
        }
        return;
      } catch (urlErr: any) {
        log.error({ error: urlErr.message }, 'Failed replying with public photo URL.');
      }
    }

    // Strategy 4: Fallback to text message
    await ctx.reply(START_MESSAGE_HTML, { parse_mode: 'HTML', ...mainMenu });
  } catch (error: any) {
    log.error({ error: error.message }, 'Error in /start handler.');
    await ctx.reply('👋 Welcome! Upload your study documents or use /study to get started.', buildMainMenuKeyboard());
  }
}
