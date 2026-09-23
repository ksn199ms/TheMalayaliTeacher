/**
 * Query Normalizer Module
 * Normalizes user queries by cleaning excess whitespace, normalizing punctuation,
 * while strictly preserving Malayalam Unicode script, technical terms, symbols, and code syntax.
 */

export class QueryNormalizer {
  /**
   * Normalizes query string safely preserving Malayalam and technical terms
   */
  public static normalize(query: string): string {
    if (!query) return '';

    let normalized = query.trim();

    // 1. Normalize unicode characters (NFC form preserves Malayalam glyph clusters)
    normalized = normalized.normalize('NFC');

    // 2. Replace multiple consecutive whitespaces and tabs with a single space
    normalized = normalized.replace(/[\t\r\n ]+/g, ' ');

    // 3. Normalize repeated punctuation (e.g., "???" -> "?", "!!!" -> "!", "...." -> "...")
    normalized = normalized.replace(/\?{2,}/g, '?');
    normalized = normalized.replace(/!{2,}/g, '!');
    normalized = normalized.replace(/\.{4,}/g, '...');

    // 4. Clean leading/trailing non-alphanumeric/non-unicode symbols (keep questions, quotes, parentheses)
    normalized = normalized.replace(/^[\s,;:\-]+/, '').trim();

    return normalized;
  }

  /**
   * Strips conversational filler prefixes while retaining the core intent
   * e.g. "Can you tell me what is TCP?" -> "What is TCP?"
   */
  public static stripConversationalPrefixes(query: string): string {
    let clean = this.normalize(query);

    const prefixes = [
      /^(?:can you please explain|could you please explain|can you please|could you please|can you explain|could you explain|please explain|please|can you|could you|tell me|explain to me|i want to know|explain)\s+/i,
      /^(?:ദയവായി വിശദീകരിക്കാമോ|ദയവായി|എനിക്ക് പറഞ്ഞുതരുമോ|പറഞ്ഞുതരാമോ|വിശദീകരിക്കാമോ)\s+/u,
    ];

    let changed = true;
    while (changed) {
      changed = false;
      for (const prefix of prefixes) {
        if (prefix.test(clean)) {
          clean = clean.replace(prefix, '').trim();
          changed = true;
        }
      }
    }

    return clean;
  }
}

export function normalizeQuery(query: string): string {
  if (!query) return '';
  let clean = QueryNormalizer.normalize(query);
  clean = clean.replace(/^(?:hello|hi|hey|ഹലോ|നമസ്കാരം)[\s,.]*/i, '');
  clean = QueryNormalizer.stripConversationalPrefixes(clean);
  clean = clean.replace(/[\s,.]*(?:thanks|thank you|നന്ദി)[\s.!]*$/i, '');
  clean = clean.replace(/[?.,!;:()\[\]{}'"]+$/g, '').trim();
  // Lowercase first letter if it starts a question
  if (clean.length > 0) {
    clean = clean.charAt(0).toLowerCase() + clean.slice(1);
  }
  return clean;
}

