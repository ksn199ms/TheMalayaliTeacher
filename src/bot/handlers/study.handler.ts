import { Context, Markup } from 'telegraf';
import { documentSelector } from '../../study/DocumentSelector.js';
import { userService } from '../../modules/users/user.service.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('study.handler');

export async function handleStudyCommand(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  log.info({ userId: from.id }, 'User opened /study hub.');

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('💬 Ask a Question', 'study:menu:ask'),
      Markup.button.callback('🧠 Explain Concept', 'study:menu:explain'),
    ],
    [
      Markup.button.callback('📝 Summarize Notes', 'study:menu:summarize'),
      Markup.button.callback('⭐ Key Points', 'study:menu:keypoints'),
    ],
    [
      Markup.button.callback('❓ Take a Quiz', 'study:menu:quiz'),
      Markup.button.callback('🗂 Flashcards', 'study:menu:flashcards'),
    ],
    [
      Markup.button.callback('💡 Simplify Concept', 'study:menu:simplify'),
    ],
  ]);

  const message = `🎓 *Student Study Assistant*

What would you like to do with your uploaded study materials?

• 💬 *Ask:* Ask any question grounded in your documents
• 🧠 *Explain:* Get simple, clear concept breakdowns with examples
• 📝 *Summarize:* Generate a high-yield structured summary
• ⭐ *Key Points:* Extract the most important takeaways
• ❓ *Quiz:* Test your knowledge with interactive MCQs
• 🗂 *Flashcards:* Practice with flip cards
• 💡 *Simplify:* Learn difficult topics using intuitive real-world analogies

_Tap an option below to get started:_`;

  await ctx.reply(message, {
    parse_mode: 'Markdown',
    ...keyboard,
  });
}

export async function handleStudyMenuAction(ctx: Context): Promise<void> {
  const from = ctx.from;
  const match = (ctx as any).match;
  if (!from || !match) return;

  const mode = match[1];
  log.info({ userId: from.id, mode }, 'User tapped study menu option.');

  try {
    await ctx.answerCbQuery();
  } catch {
    // Ignore callback query answer timeouts
  }

  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
  });
  const userId = user._id.toString();

  switch (mode) {
    case 'ask':
      await ctx.reply('💬 *Ask Mode*\n\nSimply type and send any question directly in the chat! I will retrieve relevant parts of your uploaded study materials and answer with citations.', {
        parse_mode: 'Markdown',
      });
      break;

    case 'explain':
      await ctx.reply('🧠 *Explain Mode*\n\nSend: `/explain <topic>`\n\n_Example:_ `/explain Normalization in DBMS` or `/explain "Newton third law"`', {
        parse_mode: 'Markdown',
      });
      break;

    case 'simplify':
      await ctx.reply('💡 *Simplify Mode*\n\nSend: `/simplify <topic>`\n\n_Example:_ `/simplify ACID properties` or `/simplify "TCP handshake"`', {
        parse_mode: 'Markdown',
      });
      break;

    case 'summarize':
    case 'keypoints':
    case 'quiz':
    case 'flashcards': {
      const docs = await documentSelector.getUserDocuments(userId);
      if (docs.length === 0) {
        await ctx.reply('📭 You have not uploaded any study materials yet.\n\nPlease upload a PDF, DOCX, TXT, or Markdown file first!');
        return;
      }
      const keyboard = documentSelector.buildInlineSelector(docs, mode);
      const modeTitles: Record<string, string> = {
        summarize: '📝 *Summarize Document*',
        keypoints: '⭐ *Extract Key Points*',
        quiz: '❓ *Start a Quiz*',
        flashcards: '🗂 *Practice Flashcards*',
      };
      await ctx.reply(`${modeTitles[mode]}\n\nChoose which document you would like to use:`, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
      break;
    }

    default:
      await ctx.reply('Please choose a valid study mode from /study.');
  }
}
