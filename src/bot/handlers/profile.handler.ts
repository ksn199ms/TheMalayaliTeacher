import { Context, Markup } from 'telegraf';
import { userService } from '../../modules/users/user.service.js';
import { DocumentModel } from '../../database/models/Document.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('profile.handler');

export async function handleProfileCommand(ctx: Context): Promise<void> {
  const from = ctx.from;
  if (!from) return;

  log.info({ userId: from.id }, 'User requested profile / stats.');

  try {
    const user = await userService.getOrCreateUser({
      telegramId: from.id.toString(),
      username: from.username,
      firstName: from.first_name,
      lastName: from.last_name,
    });

    // Get current active document count
    const totalDocs = await DocumentModel.countDocuments({
      userId: user._id,
      deletedAt: { $exists: false },
    });

    // Check daily usage rollover
    const today = new Date().toISOString().slice(0, 10);
    const usage = user.dailyUsage?.date === today
      ? user.dailyUsage
      : { questionsCount: 0, uploadsCount: 0, studyGenerationsCount: 0 };

    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const hoursLeft = Math.max(1, Math.ceil((midnight.getTime() - now.getTime()) / (1000 * 60 * 60)));

    const studentName = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || 'Student';

    const card = `📊 <b>വിദ്യാർത്ഥി പ്രൊഫൈൽ (Student Dashboard)</b>

👤 <b>പേര് (Name):</b> ${studentName}
🆔 <b>ടെലിഗ്രാം ഐഡി:</b> <code>${user.telegramId}</code>
🌐 <b>ഭാഷ (Language):</b> മലയാളം / English

───────────────
📚 <b>നിങ്ങളുടെ പഠന സാമഗ്രികൾ (Study Materials):</b>
• ശേഖരിച്ച ഡോക്യുമെന്റുകൾ: <b>${totalDocs} / ${config.MAX_DOCUMENTS_PER_USER}</b>

⏱ <b>ഇന്നത്തെ ഉപയോഗ പരിധി (Today's Quota):</b>
• ചോദ്യങ്ങൾ (Questions): <b>${usage.questionsCount} / ${config.MAX_DAILY_QUESTIONS}</b>
• അപ്‌ലോഡുകൾ (Uploads): <b>${usage.uploadsCount} / ${config.MAX_DAILY_DOCUMENT_UPLOADS}</b>
• ക്വിസ് & കാർഡുകൾ (Study Modes): <b>${usage.studyGenerationsCount} / ${config.MAX_DAILY_STUDY_GENERATIONS}</b>
• അടുത്ത റീസെറ്റ്: <b>${hoursLeft} മണിക്കൂറിൽ</b>
───────────────
💡 <i>ചോദ്യങ്ങൾ ചോദിക്കാനും സംശയങ്ങൾ തീർക്കാനും ഏത് സമയത്തും സന്ദേശമയക്കുക!</i>`;

    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('📚 പുസ്തകങ്ങൾ കാണുക (Docs)', 'study:menu:docs'),
        Markup.button.callback('🧠 സ്റ്റഡി മോഡുകൾ (Study)', 'study:menu:home'),
      ],
    ]);

    await ctx.reply(card, {
      parse_mode: 'HTML',
      ...keyboard,
    });
  } catch (error: any) {
    log.error({ error: error.message }, 'Failed to render student profile.');
    await ctx.reply('⚠️ പ്രൊഫൈൽ വിവരങ്ങൾ ലഭ്യമാക്കാൻ കഴിഞ്ഞില്ല. ദയവായി വീണ്ടും ശ്രമിക്കുക.');
  }
}
