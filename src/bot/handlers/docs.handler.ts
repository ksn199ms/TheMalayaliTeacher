import { Context, Markup } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { documentService } from '../../modules/documents/document.service.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('docs.handler');

export async function handleDocsCommand(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  const user = await userService.getOrCreateUser({
    telegramId: from.id.toString(),
  });

  const docs = await documentService.listUserDocuments(user._id.toString());

  if (docs.length === 0) {
    await ctx.reply(
      '📚 *Your Documents*\n\nYou have not uploaded any study materials yet.\n\nSend a PDF, DOCX, TXT, or Markdown file to get started!',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  let text = '📚 *Your Documents*\n\n';
  const buttons: any[] = [];

  docs.forEach((doc, idx) => {
    let statusIcon = '⏳ Processing';
    if (doc.status === 'ready') statusIcon = '✅ Ready';
    if (doc.status === 'failed') statusIcon = '❌ Failed';

    text += `${idx + 1}. *${doc.fileName}*\n   ${statusIcon}\n\n`;

    buttons.push([
      Markup.button.callback(`🗑 Delete ${doc.fileName.slice(0, 20)}`, `delete_${doc._id.toString()}`),
    ]);
  });

  text += 'Click a button below to delete any document:';

  await ctx.reply(text, {
    parse_mode: 'Markdown',
    ...Markup.inlineKeyboard(buttons),
  });
}

export async function handleDocumentDeleteAction(ctx: Context): Promise<void> {
  const from = ctx.from;
  const match = (ctx as any).match;

  if (!from || !match || !match[1]) {
    await ctx.answerCbQuery('Action failed.');
    return;
  }

  const documentId = match[1];

  try {
    const user = await userService.getOrCreateUser({
      telegramId: from.id.toString(),
    });

    const deleted = await documentService.deleteDocument(user._id.toString(), documentId);

    if (deleted) {
      log.info({ userId: from.id, documentId }, 'Document deleted by user.');
      await ctx.answerCbQuery('Document deleted successfully!');
      try {
        await ctx.editMessageText('✅ Document and associated vector embeddings have been deleted.');
      } catch {
        await ctx.reply('✅ Document and associated vector embeddings have been deleted.');
      }
    } else {
      await ctx.answerCbQuery('Document not found or could not be deleted.');
    }
  } catch (error: any) {
    log.error({ error: error.message, documentId }, 'Error deleting document via callback.');
    await ctx.answerCbQuery('Error deleting document.');
  }
}
