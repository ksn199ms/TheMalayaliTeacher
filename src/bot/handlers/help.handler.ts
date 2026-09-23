import { Context } from 'telegraf';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('help.handler');

export const HELP_MESSAGE = `🎓 *മലയാളി ടീച്ചർ — Help Guide*

• /start — Start the bot
• /help — Show this help manual
• /docs — View and manage your uploaded materials
• /study — Open the interactive study assistant hub
• /explain <topic> — Explain a topic simply with examples
• /simplify <topic> — Simplify a concept using real-world analogies
• /summarize — Generate a high-yield structured summary
• /keypoints — Extract essential key points & takeaways
• /quiz — Test your knowledge with interactive MCQs
• /flashcards — Practice spaced-repetition flashcards
• /save — Save notes directly sent as plain text
• /provider — View active AI & Embedding provider status
• /clear — Safely clear all your documents, vectors & chats

🌐 *Languages:* Supports English & Malayalam queries
💡 *Tip:* You can also simply type any question directly in the chat to search across your notes!`;

export async function handleHelp(ctx: Context): Promise<void> {
  const from = ctx.from;
  log.info({ userId: from?.id }, 'User requested help.');

  await ctx.reply(HELP_MESSAGE, { parse_mode: 'Markdown' });
}
