import { Context } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { explainService } from '../../study/ExplainService.js';
import { studyRateLimiter } from '../../utils/rate-limiter.js';
import { editOrSendTelegramResponse, escapeHtml } from '../../utils/telegram.js';
import { quotaService } from '../../modules/users/quota.service.js';
import { geminiDeduplicator } from '../../ai/cache/GeminiDeduplicator.js';
import { mapGeminiErrorToUserMessage } from '../utils/geminiErrorMapper.js';
import { withTimeout } from '../../utils/timeout.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('explain.handler');

export async function handleExplainCommand(ctx: Context): Promise<void> {
  const from = ctx.from;
  const message: any = ctx.message;
  if (!from || !message || !message.text) return;

  const rawText = message.text.trim();
  // Extract concept after /explain or /explain@botname
  const match = rawText.match(/^\/explain(?:@[a-zA-Z0-9_]+)?(?:\s+(.*))?$/i);
  const concept = match?.[1]?.replace(/^["']|["']$/g, '').trim();

  if (!concept) {
    await ctx.reply('🧠 *Explain Mode*\n\nPlease specify a concept to explain.\n\n_Usage:_ `/explain <concept>`\n_Example:_ `/explain normalization` or `/explain "TCP three-way handshake"`', {
      parse_mode: 'Markdown',
    });
    return;
  }

  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  });
  const userId = user._id.toString();

  // Rate limit check
  if (!studyRateLimiter.isAllowed(userId)) {
    const retrySec = studyRateLimiter.getRetryAfterSeconds(userId);
    log.warn({ userId }, 'Rate limit exceeded for study generation.');
    await ctx.reply(`⏳ You are making study requests too quickly. Please wait ${retrySec} seconds before trying again.`);
    return;
  }

  // Daily quota check
  const quotaCheck = await quotaService.checkStudyGenerationQuota(userId);
  if (!quotaCheck.allowed) {
    const errorHtml = `⚠️ <b>സ്റ്റഡി അസിസ്റ്റന്റ് പരിധി കഴിഞ്ഞു (Study Limit Reached)</b>\n\n${escapeHtml(quotaCheck.malayalamReason || '')}\n\n<i>${escapeHtml(quotaCheck.reason || '')}</i>`;
    await ctx.reply(errorHtml, { parse_mode: 'HTML' });
    return;
  }

  // Deduplication / In-flight lock
  const lockAcquired = geminiDeduplicator.acquireLock(userId, 'explain', concept.slice(0, 50));
  if (!lockAcquired) {
    await ctx.reply('⏳ An explanation for this concept is already being generated. Please wait a moment!');
    return;
  }

  // Send status indicator
  let statusMsg: any = null;
  try {
    statusMsg = await ctx.reply(`⏳ Generating explanation for "${concept}"...`);
  } catch (err: any) {
    log.warn({ err: err.message }, 'Could not send initial explain status message.');
  }

  // Keep Telegram typing indicator active
  const typingInterval = setInterval(() => {
    ctx.sendChatAction('typing').catch(() => {});
  }, 4500);
  ctx.sendChatAction('typing').catch(() => {});

  try {
    const result = await withTimeout(
      explainService.explainConcept(userId, concept),
      45_000,
      'Generating explanation took longer than expected. Please try again.'
    );
    await quotaService.incrementStudyGenerationCount(userId);

    await editOrSendTelegramResponse(ctx, statusMsg?.message_id, result.explanation);
  } catch (error: any) {
    log.error({ error: error.message, userId, concept }, 'Failed to explain concept.');
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
    geminiDeduplicator.releaseLock(userId, 'explain', concept.slice(0, 50));
  }
}
