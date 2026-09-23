import { Context } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { quotaService } from '../../modules/users/quota.service.js';
import { chatService } from '../../modules/chats/chat.service.js';
import { ragService } from '../../rag/rag.service.js';
import { ingestionService } from '../../ingestion/ingestion.service.js';
import { awaitingSaveNotes } from './save.handler.js';
import { questionRateLimiter } from '../../utils/rate-limiter.js';
import { editOrSendTelegramResponse, escapeHtml } from '../../utils/telegram.js';
import { geminiDeduplicator } from '../../ai/cache/GeminiDeduplicator.js';
import { mapGeminiErrorToUserMessage } from '../utils/geminiErrorMapper.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('message.handler');

export async function handleTextMessage(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message: any = ctx.message;

  if (!from || !message || !message.text) {
    return;
  }

  const text = message.text.trim();

  // If message is a command, ignore here (telegraf command handlers will process it)
  if (text.startsWith('/')) {
    return;
  }

  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  });

  const userId = user._id.toString();

  // 1. Check if user is in note-saving mode (/save)
  if (awaitingSaveNotes.has(from.id.toString())) {
    awaitingSaveNotes.delete(from.id.toString());
    log.info({ userId }, 'Processing plain text note save...');

    const quotaCheck = await quotaService.checkUploadQuota(userId);
    if (!quotaCheck.allowed) {
      const errorHtml = `⚠️ <b>അപ്‌ലോഡ് പരിധി കഴിഞ്ഞു (Upload Limit Reached)</b>\n\n${escapeHtml(quotaCheck.malayalamReason || '')}\n\n<i>${escapeHtml(quotaCheck.reason || '')}</i>`;
      await ctx.reply(errorHtml, { parse_mode: 'HTML' });
      return;
    }

    await ctx.reply('⏳ Saving and indexing your study note...');
    const result = await ingestionService.processPlainText(userId, text);

    if (result.success) {
      await quotaService.incrementUploadCount(userId);
      await ctx.reply('✅ Your study note has been saved and indexed!\n\nYou can now ask questions about it.');
    } else {
      await ctx.reply(`❌ Could not save your note: ${result.error || 'Unknown error'}`);
    }
    return;
  }

  // 2. Rate limit check for questions (burst control)
  if (!questionRateLimiter.isAllowed(userId)) {
    const retrySec = questionRateLimiter.getRetryAfterSeconds(userId);
    log.warn({ userId }, 'Rate limit exceeded for questions.');
    await ctx.reply(`⏳ You are asking questions too quickly. Please wait ${retrySec} seconds before asking again.`);
    return;
  }

  // 3. Daily question quota check
  const questionQuota = await quotaService.checkQuestionQuota(userId);
  if (!questionQuota.allowed) {
    const errorHtml = `⚠️ <b>ചോദ്യങ്ങളുടെ പരിധി കഴിഞ്ഞു (Question Limit Reached)</b>\n\n${escapeHtml(questionQuota.malayalamReason || '')}\n\n<i>${escapeHtml(questionQuota.reason || '')}</i>`;
    await ctx.reply(errorHtml, { parse_mode: 'HTML' });
    return;
  }

  // 4. Process as student study question
  const lockAcquired = geminiDeduplicator.acquireLock(userId, 'answer', text.slice(0, 50));
  if (!lockAcquired) {
    await ctx.reply('⏳ Your question is already being processed. Please wait a moment!');
    return;
  }

  // Send status indicator so the student knows their answer is actively generating
  let statusMsg: any = null;
  try {
    statusMsg = await ctx.reply('⏳ Generating answer...');
  } catch (err: any) {
    log.warn({ err: err.message }, 'Could not send initial generating status message.');
  }

  // Keep Telegram typing indicator active during generation
  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4500);
  ctx.sendChatAction('typing').catch(() => {});

  try {
    // Retrieve active chat thread & history
    const chat = await chatService.getOrCreateUserChat(userId);
    const history = await chatService.getRecentHistory(chat._id.toString());

    // Save user message to database
    await chatService.addMessage(chat._id.toString(), 'user', text);

    // Run RAG pipeline
    const ragResult = await ragService.answerQuestion({
      userId,
      question: text,
      conversationHistory: history.map((h) => ({ role: h.role, content: h.content })),
    });

    // Save assistant reply with citations
    await chatService.addMessage(
      chat._id.toString(),
      'assistant',
      ragResult.rawAnswer,
      ragResult.citations
    );

    // Increment successful daily question count
    await quotaService.incrementQuestionCount(userId);

    await editOrSendTelegramResponse(ctx, statusMsg?.message_id, ragResult.answer);
  } catch (error: any) {
    log.error({ error: error.message, userId }, 'Error processing student question.');
    const friendlyError = mapGeminiErrorToUserMessage(error);
    if (statusMsg && ctx.chat) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          undefined,
          friendlyError
        );
        return;
      } catch {
        try {
          await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id);
        } catch {}
      }
    }
    await ctx.reply(friendlyError);
  } finally {
    clearInterval(typingInterval);
    geminiDeduplicator.releaseLock(userId, 'answer', text.slice(0, 50));
  }
}
