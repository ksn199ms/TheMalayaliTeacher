/**
 * Simple language detection strategy for student interactions.
 * Detects Malayalam Unicode characters (U+0D00 - U+0D7F) or defaults to English.
 */
export type SupportedLanguage = 'en' | 'ml';

export function detectResponseLanguage(text?: string): SupportedLanguage {
  if (!text) return 'en';
  // Check for Malayalam characters in Unicode range U+0D00 - U+0D7F
  const malayalamRegex = /[\u0D00-\u0D7F]/;
  return malayalamRegex.test(text) ? 'ml' : 'en';
}

export function getLanguageInstruction(lang: SupportedLanguage): string {
  if (lang === 'ml') {
    return 'The user asked in Malayalam. Respond in clear, student-friendly Malayalam while preserving key English technical terms in brackets (e.g. Normalization (നോർമലൈസേഷൻ)).';
  }
  return 'Respond in clear, student-friendly English.';
}
