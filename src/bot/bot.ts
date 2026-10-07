import { Telegraf } from 'telegraf';
import { handleStart } from './handlers/start.handler.js';
import { handleHelp } from './handlers/help.handler.js';
import { handleDocsCommand, handleDocumentDeleteAction } from './handlers/docs.handler.js';
import {
  handleClearCommand,
  handleClearConfirmAction,
  handleClearCancelAction,
} from './handlers/clear.handler.js';
import { handleSaveCommand } from './handlers/save.handler.js';
import { handleProviderCommand } from './handlers/provider.handler.js';
import { handleGeminiStatusCommand } from './handlers/status.handler.js';
import { handleDocumentUpload, handlePhotoUpload } from './handlers/upload.handler.js';
import { handleTextMessage } from './handlers/message.handler.js';

// V3 Handlers
import { handleStudyCommand, handleStudyMenuAction } from './handlers/study.handler.js';
import { handleExplainCommand } from './handlers/explain.handler.js';
import { handleSimplifyCommand } from './handlers/simplify.handler.js';
import { handleSummarizeCommand, handleSummarizeDocSelect } from './handlers/summarize.handler.js';
import { handleKeypointsCommand, handleKeypointsDocSelect } from './handlers/keypoints.handler.js';
import {
  handleQuizCommand,
  handleQuizDocSelect,
  handleQuizGenerateAction,
  handleQuizAnswerAction,
} from './handlers/quiz.handler.js';
import {
  handleFlashcardsCommand,
  handleFlashcardsDocSelect,
  handleFlashcardFlipAction,
  handleFlashcardNavAction,
  handleFlashcardDoneAction,
} from './handlers/flashcards.handler.js';

import { handleLinkCommand } from './handlers/link.handler.js';
import { handleProfileCommand } from './handlers/profile.handler.js';
import { MAIN_MENU_BUTTONS } from './keyboards/keyboard.js';
import { documentSelector } from '../study/DocumentSelector.js';
import { userService } from '../modules/users/user.service.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('bot');

export function createBot(token: string): Telegraf {
  if (!token) {
    throw new Error('Telegram bot token is required to initialize bot.');
  }

  const bot = new Telegraf(token, {
    handlerTimeout: 120_000,
  });
  // Disable webhookReply so replies are sent via direct HTTPS calls immediately without timing out webhook sockets
  bot.telegram.webhookReply = false;

  // Global error handler so bot never crashes on unhandled error in a handler
  bot.catch((err: any, ctx) => {
    log.error({ err: err.message, updateType: ctx.updateType }, 'Unhandled error in Telegram update handler.');
    try {
      const errMsg = err?.message || '';
      if (errMsg.toLowerCase().includes('timed out')) {
        ctx.reply('⏳ The operation took longer than expected to process. Please try again in a moment.');
      } else {
        ctx.reply('⚠️ An unexpected error occurred. Please try again later.');
      }
    } catch (e: any) {
      log.error({ error: e.message }, 'Failed to send error message to user.');
    }
  });

  // Base V1/V2 command handlers
  bot.command('start', handleStart);
  bot.command('help', handleHelp);
  bot.command('docs', handleDocsCommand);
  bot.command('clear', handleClearCommand);
  bot.command('save', handleSaveCommand);
  bot.command('provider', handleProviderCommand);
  bot.command('gemini_status', handleGeminiStatusCommand);

  // V3 Study Mode commands
  bot.command('study', handleStudyCommand);
  bot.command('explain', handleExplainCommand);
  bot.command('simplify', handleSimplifyCommand);
  bot.command('summarize', handleSummarizeCommand);
  bot.command('keypoints', handleKeypointsCommand);
  bot.command('quiz', handleQuizCommand);
  bot.command('flashcards', handleFlashcardsCommand);
  bot.command('link', handleLinkCommand);
  bot.command('profile', handleProfileCommand);
  bot.command('stats', handleProfileCommand);

  // Quick navigation menu buttons (ReplyKeyboardMarkup)
  bot.hears(MAIN_MENU_BUTTONS.STUDY, handleStudyCommand);
  bot.hears(MAIN_MENU_BUTTONS.DOCS, handleDocsCommand);
  bot.hears(MAIN_MENU_BUTTONS.QUIZ, handleQuizCommand);
  bot.hears(MAIN_MENU_BUTTONS.FLASHCARDS, handleFlashcardsCommand);
  bot.hears(MAIN_MENU_BUTTONS.SUMMARY, handleSummarizeCommand);
  bot.hears(MAIN_MENU_BUTTONS.SIMPLIFY, async (ctx) => {
    await ctx.reply(
      '💡 <b>ലളിതമാക്കുക (Simplify Mode)</b>\n\nഏതെങ്കിലും ഒരു വിഷയം ലളിതമായി മനസ്സിലാക്കാൻ താഴെ നൽകിയിരിക്കുന്ന രീതിയിൽ ടൈപ്പ് ചെയ്യുക:\n\n<code>/simplify &lt;വിഷയം&gt;</code>\n<i>ഉദാഹരണം:</i> <code>/simplify photosynthesis</code>',
      { parse_mode: 'HTML' }
    );
  });
  bot.hears(MAIN_MENU_BUTTONS.PROFILE, handleProfileCommand);
  bot.hears(MAIN_MENU_BUTTONS.HELP, handleHelp);

  // Document & Photo upload listeners
  bot.on('document', handleDocumentUpload);
  bot.on('photo', handlePhotoUpload);

  // Callback action routers
  bot.action(/^study:menu:(.+)$/, handleStudyMenuAction);

  // Unified Document Selector Callback router
  bot.action(/^docsel:(.+):(.+)$/, async (ctx) => {
    const mode = ctx.match[1];
    const docId = ctx.match[2];
    try {
      await ctx.answerCbQuery();
    } catch {}

    switch (mode) {
      case 'summarize':
        return handleSummarizeDocSelect(ctx, docId);
      case 'keypoints':
        return handleKeypointsDocSelect(ctx, docId);
      case 'quiz':
        return handleQuizDocSelect(ctx, docId);
      case 'flashcards':
        return handleFlashcardsDocSelect(ctx, docId);
      default:
        await ctx.reply('⚠️ Unrecognized study mode selection.');
    }
  });

  // Document Selector Pagination Callback router
  bot.action(/^docpage:(.+):(\d+)$/, async (ctx) => {
    const mode = ctx.match[1] as any;
    const page = parseInt(ctx.match[2], 10) || 0;
    try {
      await ctx.answerCbQuery();
    } catch {}

    const from = ctx.from;
    if (!from) return;

    const user = await userService.getOrCreateUser({
      telegramId: from.id.toString(),
    });
    const docs = await documentSelector.getUserDocuments(user._id.toString());
    const keyboard = documentSelector.buildInlineSelector(docs, mode, page);
    const text = documentSelector.formatDocumentList(docs, page);

    if (ctx.chat && ctx.callbackQuery?.message?.message_id) {
      try {
        await ctx.telegram.editMessageText(
          ctx.chat.id,
          ctx.callbackQuery.message.message_id,
          undefined,
          text,
          { parse_mode: 'Markdown', ...keyboard }
        );
      } catch {}
    }
  });

  bot.action('docpage:noop', async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {}
  });

  // Quiz interactive callbacks
  bot.action(/^quizgen:(.+):(\d+)$/, handleQuizGenerateAction);
  bot.action(/^quiz:(.+):ans:(\d+)$/, handleQuizAnswerAction);

  // Flashcards interactive callbacks
  bot.action(/^fc:(.+):flip$/, handleFlashcardFlipAction);
  bot.action(/^fc:(.+):nav:(\d+)$/, handleFlashcardNavAction);
  bot.action(/^fc:(.+):done$/, handleFlashcardDoneAction);
  bot.action(/^fc:(.+):noop$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
    } catch {}
  });

  // Clear data confirmation callbacks
  bot.action('clear:confirm', handleClearConfirmAction);
  bot.action('clear:cancel', handleClearCancelAction);

  // Existing document delete action
  bot.action(/^delete_(.+)$/, handleDocumentDeleteAction);

  // General text handler for student questions and save-mode notes
  bot.on('text', handleTextMessage);

  return bot;
}
