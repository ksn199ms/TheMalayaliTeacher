import { Context, Markup } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { documentSelector } from '../../study/DocumentSelector.js';
import { quizService } from '../../study/QuizService.js';
import { studySessionService } from '../../study/StudySessionService.js';
import { studyRateLimiter } from '../../utils/rate-limiter.js';
import { geminiDeduplicator } from '../../ai/cache/GeminiDeduplicator.js';
import { mapGeminiErrorToUserMessage } from '../utils/geminiErrorMapper.js';
import { withTimeout } from '../../utils/timeout.js';
import { quotaService } from '../../modules/users/quota.service.js';
import { sendTelegramResponse, formatToTelegramHtml, escapeHtml } from '../../utils/telegram.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('quiz.handler');

export async function handleQuizCommand(ctx: Context): Promise<void> {
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
    await ctx.reply('📭 You have not uploaded any study materials yet.\n\nPlease upload a PDF, DOCX, TXT, or Markdown file first to generate a quiz!');
    return;
  }

  const keyboard = documentSelector.buildInlineSelector(docs, 'quiz');
  await ctx.reply('❓ *Choose a document for your quiz:*\n\n_Select from your uploaded documents below:_', {
    parse_mode: 'Markdown',
    ...keyboard,
  });
}

/**
 * Handle document selection for quiz: prompts student for question count
 */
export async function handleQuizDocSelect(ctx: Context, documentId: string): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
  });
  const userId = user._id.toString();

  const doc = await documentSelector.validateOwnership(userId, documentId);
  if (!doc) {
    await ctx.reply('⚠️ Document not found or access denied.');
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('5 Questions', `quizgen:${documentId}:5`),
      Markup.button.callback('10 Questions', `quizgen:${documentId}:10`),
      Markup.button.callback('15 Questions', `quizgen:${documentId}:15`),
    ],
  ]);

  await ctx.reply(`🧠 *Quiz on: ${doc.fileName}*\n\nHow many questions would you like?`, {
    parse_mode: 'Markdown',
    ...keyboard,
  });
}

/**
 * Handle question count selection: generates quiz and renders question 1
 */
export async function handleQuizGenerateAction(ctx: Context): Promise<void> {
  const from = ctx.from;
  const match = (ctx as any).match;
  if (!from || !match) return;

  const documentId = match[1];
  const count = parseInt(match[2], 10) || 5;

  try {
    await ctx.answerCbQuery();
  } catch {}

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
  const lockAcquired = geminiDeduplicator.acquireLock(userId, 'quiz', `${documentId}:${count}`);
  if (!lockAcquired) {
    await ctx.reply('⏳ Your quiz for this document is already being generated. Please wait a moment!');
    return;
  }

  await ctx.reply(`⏳ Generating your ${count}-question quiz from your notes... Please wait a few seconds.`);
  await ctx.sendChatAction('typing');

  try {
    const session = await withTimeout(
      quizService.generateQuiz(userId, documentId, count),
      45_000,
      'Generating quiz took longer than expected. Please try again.'
    );
    await quotaService.incrementStudyGenerationCount(userId);

    // Render Question 1
    const { text, keyboard } = quizService.renderQuestion(session, 0);
    await ctx.reply(formatToTelegramHtml(text), {
      parse_mode: 'HTML',
      ...keyboard,
    });
  } catch (error: any) {
    log.error({ error: error.message, userId, documentId }, 'Failed to generate quiz.');
    await ctx.reply(mapGeminiErrorToUserMessage(error));
  } finally {
    geminiDeduplicator.releaseLock(userId, 'quiz', `${documentId}:${count}`);
  }
}

/**
 * Handle student answer submission on inline keyboard
 */
export async function handleQuizAnswerAction(ctx: Context): Promise<void> {
  const from = ctx.from;
  const match = (ctx as any).match;
  if (!from || !match) return;

  const sessionId = match[1];
  const selectedAnswer = parseInt(match[2], 10);

  try {
    await ctx.answerCbQuery();
  } catch {}

  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
  });
  const userId = user._id.toString();

  // Security & Expiration Check
  const session = await studySessionService.getActiveSession(userId, sessionId);
  if (!session) {
    await ctx.reply('⏰ This study session has expired or is no longer active.\n\nStart a new one with /quiz!');
    return;
  }

  const currentIdx = session.currentQuestion;
  const currentQ = session.questions[currentIdx];
  if (!currentQ) {
    await ctx.reply('⚠️ Unexpected question state. Start a new quiz with /quiz.');
    return;
  }

  // Record answer and get validation
  const result = await studySessionService.recordQuizAnswer(sessionId, currentIdx, selectedAnswer);
  if (!result) {
    await ctx.reply('⚠️ Could not record answer. Please try again.');
    return;
  }

  // Format and send immediate feedback
  const citation = currentQ.citations[0];
  const feedback = quizService.formatAnswerFeedback(
    result.isCorrect,
    result.correctAnswer,
    result.explanation,
    citation?.fileName || 'Document',
    citation?.pageNumber
  );

  await sendTelegramResponse(ctx, feedback);

  // If more questions remain, render next question
  if (result.session.status === 'active' && result.session.currentQuestion < result.session.totalQuestions) {
    const nextIdx = result.session.currentQuestion;
    const { text, keyboard } = quizService.renderQuestion(result.session, nextIdx);
    await ctx.reply(formatToTelegramHtml(text), {
      parse_mode: 'HTML',
      ...keyboard,
    });
  } else {
    // Quiz completed! Send final score report
    const finalCard = quizService.formatFinalResults(result.session);
    await sendTelegramResponse(ctx, finalCard);
  }
}
