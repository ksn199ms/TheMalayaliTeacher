import { Context } from 'telegraf';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('save.handler');

// Track users who have typed /save and are waiting to send their text notes
export const awaitingSaveNotes = new Set<string>();

export async function handleSaveCommand(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  awaitingSaveNotes.add(from.id.toString());
  log.info({ userId: from.id }, 'User entered /save mode.');

  await ctx.reply(
    '📝 *Save Study Material Note*\n\nPlease send the text note you want to save as study material. It will be indexed and made searchable for your questions.',
    { parse_mode: 'Markdown' }
  );
}
