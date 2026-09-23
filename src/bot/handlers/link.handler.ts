import { Context } from 'telegraf';
import { sendTelegramResponse } from '../../utils/telegram.js';

export async function handleLinkCommand(ctx: Context): Promise<void> {
  await sendTelegramResponse(
    ctx,
    `ℹ️ **Standalone Telegram Bot**\n\n*മലയാളി ടീച്ചർ* runs 100% directly and exclusively in Telegram!\n\nYou don't need any external web application or accounts. You can upload study notes, photos, and PDFs right here in this chat to study, ask questions, take quizzes, and practice flashcards.`
  );
}
