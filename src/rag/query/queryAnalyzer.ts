/**
 * Query Analyzer Module
 * Analyzes query intent, language, key technical terms, comparison concepts,
 * and detects conversational follow-up patterns.
 */

export type QueryIntent =
  | 'definition'
  | 'explanation'
  | 'comparison'
  | 'summary'
  | 'procedure'
  | 'advantages'
  | 'code'
  | 'fact';

export interface QueryAnalysis {
  originalQuery: string;
  normalizedQuery: string;
  language: 'en' | 'ml' | 'mixed';
  intent: QueryIntent;
  keywords: string[];
  concepts: string[];
  isFollowUp: boolean;
  isComparison: boolean;
  requiresMultiHop: boolean;
}

export class QueryAnalyzer {
  private static FOLLOW_UP_PATTERNS = [
    /\b(?:it|its|they|them|these|those|this|that)\b/i,
    /\b(?:the (?:first|second|third|fourth|last|previous|next|above|other) one)\b/i,
    /^(?:why|how so|what about that|and then|what else)\??$/i,
    /^(?:എന്തുകൊണ്ട്|ഇത്|അത്|രണ്ടാമത്തേത്|മറ്റൊന്ന്)\??$/u,
    /\b(?:ഇതിനെക്കുറിച്ച്|അതിനെക്കുറിച്ച്|ഇതിന്റെ|അതിന്റെ)\b/u,
  ];

  private static INTENT_PATTERNS: Array<{ intent: QueryIntent; regex: RegExp }> = [
    {
      intent: 'comparison',
      regex: /(?:\b(?:difference between|differ from|vs|versus|compare|compared to|distinguish|preferable over)\b|(?:വ്യത്യാസം|തമ്മിലുള്ള വ്യത്യാസം))/iu,
    },
    {
      intent: 'definition',
      regex: /(?:^(?:what is|define|meaning of|what do you mean by)\b|(?:എന്താണ്|നിർവചിക്കുക))/iu,
    },
    {
      intent: 'advantages',
      regex: /(?:\b(?:advantages?|benefits?|pros and cons|merits?|drawbacks?|disadvantages?)\b|(?:ഗുണങ്ങൾ|നേട്ടങ്ങൾ|ദോഷങ്ങൾ))/iu,
    },
    {
      intent: 'summary',
      regex: /(?:\b(?:summarize|summary|overview|brief)\b|(?:സംഗ്രഹം|ചുരുക്കം))/iu,
    },
    {
      intent: 'code',
      regex: /(?:\b(?:code|function|syntax|program|implementation|algorithm|method|sql|query|try\s+catch)\b|(?:ക്ലാസ്|കോഡ്))/iu,
    },
    {
      intent: 'procedure',
      regex: /(?:\b(?:how to|steps to|procedure for|how do (?:we|i))\b|(?:എങ്ങനെയാണ്|ഘട്ടങ്ങൾ|വഴികൾ|രീതികൾ))/iu,
    },
    {
      intent: 'explanation',
      regex: /(?:\b(?:explain|describe|details on|why does|how does|why is|how|example|illustration)\b|(?:വിശദീകരിക്കുക|എന്തുകൊണ്ടാണ്|എങ്ങനെ|പ്രവർത്തിക്കുന്നു|ഉദാഹരണം))/iu,
    },
  ];

  /**
   * Detects language of query
   */
  public static detectLanguage(query: string): 'en' | 'ml' | 'mixed' {
    const malayalamChars = (query.match(/[\u0D00-\u0D7F]/g) || []).length;
    const englishChars = (query.match(/[a-zA-Z]/g) || []).length;

    if (malayalamChars > 3 && englishChars > 3) {
      return 'mixed';
    }
    if (malayalamChars > 3) {
      return 'ml';
    }
    return 'en';
  }

  /**
   * Extracts essential search keywords, technical acronyms, port numbers, and compound terms
   */
  public static extractKeywords(query: string): string[] {
    const cleaned = query.replace(/[?.,!;:()\[\]{}'"]/g, ' ');
    const tokens = cleaned.split(/\s+/).filter(Boolean);

    const stopwords = new Set([
      'what', 'is', 'are', 'the', 'a', 'an', 'in', 'on', 'of', 'for', 'to', 'from',
      'and', 'or', 'by', 'with', 'about', 'can', 'you', 'tell', 'me', 'please',
      'explain', 'describe', 'give', 'some', 'how', 'why', 'which', 'who', 'does',
      'do', 'did', 'that', 'this', 'these', 'those', 'it', 'its', 'their',
      'എന്താണ്', 'എങ്ങനെ', 'ഒരു', 'ആണ്', 'ഉള്ള', 'എന്നത്', 'വിശദീകരിക്കുക'
    ]);

    const keywords: string[] = [];

    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (stopwords.has(lower)) continue;

      // Keep if contains numbers, uppercase acronyms (TCP, ACID), or significant length
      if (
        /[0-9]/.test(token) ||
        /[A-Z]{2,}/.test(token) ||
        token.length > 2 ||
        /[\u0D00-\u0D7F]/.test(token)
      ) {
        keywords.push(token);
      }
    }

    return Array.from(new Set(keywords));
  }

  /**
   * Extracts distinct concepts for comparison or multi-concept questions
   */
  public static extractConcepts(query: string): string[] {
    const cleanConcept = (str: string): string => {
      return str
        .replace(/^(?:compare|difference between|distinguish between|between)\s+/i, '')
        .replace(/\s+(?:in|for|with|of)\s+.*$/i, '')
        .trim();
    };

    const concepts: string[] = [];

    // Check "difference between X and Y"
    const diffMatch = query.match(/(?:difference between|compare|distinguish between)\s+(.+?)\s+(?:and|&)\s+(.+?)(?:\?|$)/i);
    if (diffMatch && diffMatch[1] && diffMatch[2]) {
      concepts.push(cleanConcept(diffMatch[1]), cleanConcept(diffMatch[2]));
      return concepts;
    }

    // Check "X vs Y" or "X versus Y"
    const vsMatch = query.match(/(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:\?|$)/i);
    if (vsMatch && vsMatch[1] && vsMatch[2]) {
      concepts.push(cleanConcept(vsMatch[1]), cleanConcept(vsMatch[2]));
      return concepts;
    }

    // Check Malayalam "Xഉം Yയും തമ്മിലുള്ള വ്യത്യാസം"
    const mlDiffMatch = query.match(/(.+?)(?:യും|ഉം)\s+(.+?)(?:യും|ഉം)\s+തമ്മിലുള്ള\s+വ്യത്യാസം/u);
    if (mlDiffMatch && mlDiffMatch[1] && mlDiffMatch[2]) {
      concepts.push(mlDiffMatch[1].trim(), mlDiffMatch[2].trim());
      return concepts;
    }

    return concepts;
  }

  /**
   * Comprehensive analysis of the incoming student question
   */
  public static analyze(query: string): QueryAnalysis {
    const normalized = query.trim();
    const language = this.detectLanguage(normalized);

    // Intent detection
    let intent: QueryIntent = 'fact';
    for (const item of this.INTENT_PATTERNS) {
      if (item.regex.test(normalized)) {
        intent = item.intent;
        break;
      }
    }

    // Follow up detection
    const isFollowUp = this.FOLLOW_UP_PATTERNS.some((pattern) => pattern.test(normalized));

    // Concepts & comparison
    const concepts = this.extractConcepts(normalized);
    const isComparison = intent === 'comparison' || concepts.length >= 2;
    const keywords = this.extractKeywords(normalized);

    return {
      originalQuery: query,
      normalizedQuery: normalized,
      language,
      intent,
      keywords,
      concepts,
      isFollowUp,
      isComparison,
      requiresMultiHop: isComparison || keywords.length > 5,
    };
  }
}

export type AnalyzedQuery = QueryAnalysis;
export const analyzeQuery = (query: string): QueryAnalysis => QueryAnalyzer.analyze(query);

