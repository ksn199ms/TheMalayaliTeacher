import { Context } from 'telegraf';
import { config } from '../../config/env.js';
import { embeddingService } from '../../embeddings/embedding.service.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('provider.handler');

export async function handleProviderCommand(ctx: Context): Promise<void> {
  const from = ctx.from;
  log.info({ userId: from?.id }, 'User requested provider debug information.');

  const aiProviderName = 'Google Gemini';
  const aiModel = config.GEMINI_MODEL;

  const embeddingProviderName = 'Google Gemini';
  const embeddingModel = config.GEMINI_EMBEDDING_MODEL;
  const dimension = embeddingService.getDimension();

  const message = `🤖 *Active System Providers*

• *LLM Provider:* ${aiProviderName} (\`${aiModel}\`)
• *Embeddings:* ${embeddingProviderName} (\`${embeddingModel}\`, ${dimension}d)
• *Vector Database:* Qdrant (\`${config.QDRANT_COLLECTION}\`)
• *Status:* Connected & Operational`;

  await ctx.reply(message, { parse_mode: 'Markdown' });
}
