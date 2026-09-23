import fs from 'node:fs/promises';
import path from 'node:path';
import { Context } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { buildMainMenuKeyboard } from '../keyboards/keyboard.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('start.handler');

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
    const starterImagePath = path.resolve(process.cwd(), 'public', 'starter.jpg');
    let imageExists = false;
    try {
      await fs.access(starterImagePath);
      imageExists = true;
    } catch {
      imageExists = false;
    }

    if (imageExists && typeof ctx.replyWithPhoto === 'function') {
      try {
        await ctx.replyWithPhoto(
          { source: starterImagePath },
          { caption: START_MESSAGE, parse_mode: 'Markdown', ...mainMenu }
        );
        return;
      } catch (photoErr: any) {
        log.warn({ error: photoErr.message }, 'Failed to reply with starter photo, falling back to text.');
      }
    }

    await ctx.reply(START_MESSAGE, { parse_mode: 'Markdown', ...mainMenu });
  } catch (error: any) {
    log.error({ error: error.message }, 'Error in /start handler.');
    await ctx.reply('👋 Welcome! Upload your study documents or use /study to get started.', buildMainMenuKeyboard());
  }
}
