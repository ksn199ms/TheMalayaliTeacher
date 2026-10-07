import { Context } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { documentSelector } from '../../study/DocumentSelector.js';
import { flashcardService } from '../../study/FlashcardService.js';
import { studySessionService } from '../../study/StudySessionService.js';
import { studyRateLimiter } from '../../utils/rate-limiter.js';
import { geminiDeduplicator } from '../../ai/cache/GeminiDeduplicator.js';
import { mapGeminiErrorToUserMessage } from '../utils/geminiErrorMapper.js';
import { withTimeout } from '../../utils/timeout.js';
import { quotaService } from '../../modules/users/quota.service.js';
import { formatToTelegramHtml, escapeHtml } from '../../utils/telegram.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('flashcards.handler');

export async function handleFlashcardsCommand(ctx: Context): Promise<void> {
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
    await ctx.reply('📭 You have not uploaded any study materials yet.\n\nPlease upload a PDF, DOCX, TXT, or Markdown file first to generate flashcards!');
    return;
  }

  const keyboard = documentSelector.buildInlineSelector(docs, 'flashcards');
  await ctx.reply('🗂 *Choose a document for flashcards:*\n\n_Select from your uploaded documents below:_', {
    parse_mode: 'Markdown',
    ...keyboard,
  });
}

/**
 * Handle document selection for flashcards: generates cards and renders Card 1
 */
export async function handleFlashcardsDocSelect(ctx: Context, documentId: string): Promise<void> {
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
  const lockAcquired = geminiDeduplicator.acquireLock(userId, 'flashcards', documentId);
  if (!lockAcquired) {
    await ctx.reply('⏳ Your flashcards for this document are already being generated. Please wait a moment!');
    return;
  }

  await ctx.reply('⏳ Generating high-yield flashcards from your study materials...');
  await ctx.sendChatAction('typing');

  try {
    const session = await withTimeout(
      flashcardService.generateFlashcards(userId, documentId, 8),
      45_000,
      'Generating flashcards took longer than expected. Please try again.'
    );
    await quotaService.incrementStudyGenerationCount(userId);

    const { text, keyboard } = flashcardService.renderFlashcard(session);
    await ctx.reply(formatToTelegramHtml(text), {
      parse_mode: 'HTML',
      ...keyboard,
    });
  } catch (error: any) {
    log.error({ error: error.message, userId, documentId }, 'Failed to generate flashcards.');
    await ctx.reply(mapGeminiErrorToUserMessage(error));
  } finally {
    geminiDeduplicator.releaseLock(userId, 'flashcards', documentId);
  }
}

/**
 * Handle flip action (toggles between Front and Back)
 */
export async function handleFlashcardFlipAction(ctx: Context): Promise<void> {
  const from = ctx.from;
  const match = (ctx as any).match;
  if (!from || !match) return;

  const sessionId = match[1];
  try {
    await ctx.answerCbQuery();
  } catch {}

  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
  });
  const userId = user._id.toString();

  const session = await studySessionService.getActiveSession(userId, sessionId);
  if (!session) {
    await ctx.reply('⏰ This flashcard session has expired. Start a new one with /flashcards.');
    return;
  }

  // Toggle showingAnswer
  const updatedSession = await studySessionService.updateFlashcardNav(
    sessionId,
    session.currentCard,
    !session.showingAnswer
  );
  if (!updatedSession) return;

  const { text, keyboard } = flashcardService.renderFlashcard(updatedSession);
  try {
    await ctx.editMessageText(formatToTelegramHtml(text), {
      parse_mode: 'HTML',
      ...keyboard,
    });
  } catch {
    // If text didn't change or edit failed, ignore
  }
}

/**
 * Handle navigation action (Previous / Next card)
 */
export async function handleFlashcardNavAction(ctx: Context): Promise<void> {
  const from = ctx.from;
  const match = (ctx as any).match;
  if (!from || !match) return;

  const sessionId = match[1];
  const targetCard = parseInt(match[2], 10);

  try {
    await ctx.answerCbQuery();
  } catch {}

  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
  });
  const userId = user._id.toString();

  const session = await studySessionService.getActiveSession(userId, sessionId);
  if (!session) {
    await ctx.reply('⏰ This flashcard session has expired. Start a new one with /flashcards.');
    return;
  }

  // Switch card and reset showingAnswer to false (show front of new card)
  const updatedSession = await studySessionService.updateFlashcardNav(
    sessionId,
    targetCard,
    false
  );
  if (!updatedSession) return;

  const { text, keyboard } = flashcardService.renderFlashcard(updatedSession);
  try {
    await ctx.editMessageText(formatToTelegramHtml(text), {
      parse_mode: 'HTML',
      ...keyboard,
    });
  } catch {}
}

/**
 * Handle done / completion of flashcard session
 */
export async function handleFlashcardDoneAction(ctx: Context): Promise<void> {
  try {
    await ctx.answerCbQuery('Flashcard review completed! 🎉');
  } catch {}
  await ctx.reply('🎉 *Flashcards Completed!*\n\nGreat revision session. You can practice again anytime using /flashcards or /study.', {
    parse_mode: 'Markdown',
  });
}
