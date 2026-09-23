import { Markup } from 'telegraf';

export const MAIN_MENU_BUTTONS = {
  STUDY: '🧠 സ്റ്റഡി മോഡ് (Study Menu)',
  DOCS: '📚 എന്റെ പുസ്തകങ്ങൾ (My Docs)',
  QUIZ: '❓ ക്വിസ് (Quiz)',
  FLASHCARDS: '🗂 ഫ്ലാഷ്കാർഡുകൾ (Flashcards)',
  SUMMARY: '📝 സംഗ്രഹം (Summary)',
  SIMPLIFY: '💡 ലളിതമാക്കുക (Simplify)',
  PROFILE: '📊 പ്രൊഫൈൽ (My Profile)',
  HELP: '⚙️ സഹായം (Help)',
};

/**
 * Builds the persistent bottom ReplyKeyboardMarkup for mobile navigation
 */
export function buildMainMenuKeyboard() {
  return Markup.keyboard([
    [MAIN_MENU_BUTTONS.STUDY, MAIN_MENU_BUTTONS.DOCS],
    [MAIN_MENU_BUTTONS.QUIZ, MAIN_MENU_BUTTONS.FLASHCARDS],
    [MAIN_MENU_BUTTONS.SUMMARY, MAIN_MENU_BUTTONS.SIMPLIFY],
    [MAIN_MENU_BUTTONS.PROFILE, MAIN_MENU_BUTTONS.HELP],
  ]).resize();
}
