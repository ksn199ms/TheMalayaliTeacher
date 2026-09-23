import { Context, Markup } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { chatService } from '../../modules/chats/chat.service.js';
import { documentService } from '../../modules/documents/document.service.js';
import { StudySession } from '../../database/models/StudySession.js';
import { Types } from 'mongoose';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('clear.handler');

/**
 * Handle /clear command by asking for confirmation first
 */
export async function handleClearCommand(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('❌ Cancel', 'clear:cancel'),
      Markup.button.callback('✅ Delete Everything', 'clear:confirm'),
    ],
  ]);

  const warning = `⚠️ *Are you sure you want to reset your data?*

This action will permanently delete:
• All your uploaded study materials & notes
• All vector search indexes & embeddings
• All active quiz and flashcard sessions
• Your entire conversation history

_This action cannot be undone._`;

  await ctx.reply(warning, {
    parse_mode: 'Markdown',
    ...keyboard,
  });
}

/**
 * Handle confirmation of clear
 */
export async function handleClearConfirmAction(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  try {
    await ctx.answerCbQuery();
  } catch {}

  try {
    const user = await userService.getOrCreateUser({
      telegramId: from.id.toString(),
    });
    const userId = user._id.toString();

    log.info({ userId }, 'User confirmed complete data clear.');

    // 1. Clear all documents, local files & Qdrant vectors
    const deletedDocs = await documentService.clearAllUserDocuments(userId);

    // 2. Clear all study sessions
    await StudySession.deleteMany({ userId: new Types.ObjectId(userId) });

    // 3. Clear chat conversation history
    const chat = await chatService.getOrCreateUserChat(userId);
    await chatService.clearChat(chat._id.toString());

    await ctx.editMessageText(
      `🗑️ *All Data Cleared Successfully!*\n\n• Deleted ${deletedDocs} document(s) & vector embeddings\n• Cleared all study sessions\n• Reset conversation history\n\nYou can upload fresh study notes anytime!`,
      { parse_mode: 'Markdown' }
    );
  } catch (error: any) {
    log.error({ error: error.message, userId: from.id }, 'Failed to clear user data.');
    await ctx.reply('⚠️ An error occurred while clearing your data. Please try again.');
  }
}

/**
 * Handle cancellation of clear
 */
export async function handleClearCancelAction(ctx: Context): Promise<void> {
  try {
    await ctx.answerCbQuery('Reset cancelled.');
    await ctx.editMessageText('✅ *Reset cancelled.* Your documents, vectors, and study sessions remain safe!', {
      parse_mode: 'Markdown',
    });
  } catch {}
}
