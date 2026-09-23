import { Context } from 'telegraf';
import { geminiRequestManager } from '../../ai/GeminiRequestManager.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('status.handler');

export async function handleGeminiStatusCommand(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  log.info({ userId: from.id }, 'User checked Gemini status.');

  const status = geminiRequestManager.getStatus();

  const circuitEmoji =
    status.circuitState === 'CLOSED'
      ? '🟢 Healthy (CLOSED)'
      : status.circuitState === 'HALF_OPEN'
      ? '🟡 Testing (HALF-OPEN)'
      : '🔴 Quota Paused (OPEN)';

  const message = `🤖 *Gemini AI Service Status*

• *Model:* \`${config.GEMINI_MODEL}\`
• *Circuit Status:* ${circuitEmoji}
• *Concurrency:* \`${status.concurrency.active}/${status.concurrency.max}\` (Active)
• *Queue Length:* \`${status.concurrency.queued}\`

📊 *Observed Today (Local Session):*
• *Total Requests:* ${status.observedToday.totalRequests}
• *Successful:* ${status.observedToday.successfulRequests}
• *Failed:* ${status.observedToday.failedRequests}
• *Retries:* ${status.observedToday.retriesCount}

⏱ *Estimated Daily Quota Reset:*
_${status.estimatedResetTime || 'Pacific Time Midnight'}_

_${status.openReason ? `⚠️ Open Reason: ${status.openReason}` : '✅ System operating normally.'}_`;

  await ctx.reply(message, { parse_mode: 'Markdown' });
}
