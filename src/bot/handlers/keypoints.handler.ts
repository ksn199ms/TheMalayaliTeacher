import { Context } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { documentSelector } from '../../study/DocumentSelector.js';
import { keypointsService } from '../../study/KeypointsService.js';
import { studyRateLimiter } from '../../utils/rate-limiter.js';
import { sendTelegramResponse, escapeHtml } from '../../utils/telegram.js';
import { quotaService } from '../../modules/users/quota.service.js';
import { geminiDeduplicator } from '../../ai/cache/GeminiDeduplicator.js';
import { mapGeminiErrorToUserMessage } from '../utils/geminiErrorMapper.js';
import { withTimeout } from '../../utils/timeout.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('keypoints.handler');

export async function handleKeypointsCommand(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
    username: from.username,
    firstName: from.first_name,
    lastName: from.last_name,
  });
  const userId = user._id.toString();

  const docs = await documentSelector.getUserDocuments(userId);
  if (docs.length === 0) {
    await ctx.reply('📭 You have not uploaded any study materials yet.\n\nPlease upload a PDF, DOCX, TXT, or Markdown file first!');
    return;
  }

  const keyboard = documentSelector.buildInlineSelector(docs, 'keypoints');
  await ctx.reply('⭐ *Which document would you like to extract key points from?*\n\n_Select from your uploaded documents below:_', {
    parse_mode: 'Markdown',
    ...keyboard,
  });
}

export async function handleKeypointsDocSelect(ctx: Context, documentId: string): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
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
  const lockAcquired = geminiDeduplicator.acquireLock(userId, 'keypoints', documentId);
  if (!lockAcquired) {
    await ctx.reply('⏳ Key points for this document are already being extracted. Please wait a moment!');
    return;
  }

  await ctx.reply('⏳ Extracting high-yield key points from your document...');
  await ctx.sendChatAction('typing');

  try {
    const result = await withTimeout(
      keypointsService.extractKeypoints(userId, documentId),
      45_000,
      'Extracting key points took longer than expected. Please try again.'
    );
    await quotaService.incrementStudyGenerationCount(userId);

    await sendTelegramResponse(ctx, result.keypointsText);
  } catch (error: any) {
    log.error({ error: error.message, userId, documentId }, 'Failed to extract key points.');
    await ctx.reply(mapGeminiErrorToUserMessage(error));
  } finally {
    geminiDeduplicator.releaseLock(userId, 'keypoints', documentId);
  }
}
