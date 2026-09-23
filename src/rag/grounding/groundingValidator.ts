import { RetrievedChunk } from '../retriever.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('grounding.validator');

export interface GroundingResult {
  isGrounded: boolean;
  score: number;
  unsupportedClaims: string[];
  suggestedFallback?: string;
}

export class GroundingValidator {
  private minGroundingScore: number;

  constructor(minGroundingScore: number = 0.35) {
    this.minGroundingScore = minGroundingScore;
  }

  /**
   * Validates whether the generated answer is grounded in the retrieved context chunks.
   * Checks token/entity overlap, numbers, and technical terms.
   */
  public validateGrounding(
    answer: string,
    contextChunks: RetrievedChunk[],
    queryLanguage: 'en' | 'ml' | 'mixed' = 'en'
  ): GroundingResult {
    if (!config.ENABLE_GROUNDING_VALIDATION) {
      return { isGrounded: true, score: 1.0, unsupportedClaims: [] };
    }

    if (!answer || answer.trim() === '') {
      return { isGrounded: false, score: 0, unsupportedClaims: ['Empty answer generated'] };
    }

    // If context is completely empty
    if (!contextChunks || contextChunks.length === 0) {
      const fallback =
        queryLanguage === 'ml'
          ? 'നിങ്ങൾ നൽകിയ പഠന സാമഗ്രികളിൽ ഈ ചോദ്യത്തിനുള്ള മതിയായ വിവരങ്ങൾ ലഭ്യമല്ല.'
          : 'The provided study materials do not contain sufficient information to answer this question accurately.';

      return {
        isGrounded: false,
        score: 0,
        unsupportedClaims: ['No context chunks were retrieved.'],
        suggestedFallback: fallback,
      };
    }

    // Check if the LLM self-identified that context is insufficient
    const lowerAnswer = answer.toLowerCase();
    const insufficientPhrases = [
      'does not contain',
      'do not contain',
      'not mentioned in the provided',
      'not found in the document',
      'no information provided',
      'മതിയായ വിവരങ്ങൾ ലഭ്യമല്ല',
      'രേഖകളിൽ കാണുന്നില്ല',
    ];

    const acknowledgedInsufficient = insufficientPhrases.some((phrase) => lowerAnswer.includes(phrase));
    if (acknowledgedInsufficient) {
      log.debug('Answer acknowledged insufficient context in source materials.');
      return { isGrounded: true, score: 1.0, unsupportedClaims: [] };
    }

    // Aggregate all context text
    const fullContext = contextChunks.map((c) => c.text).join(' ').toLowerCase();

    // Extract significant terms from the answer (words > 3 chars, numbers, acronyms)
    const answerTerms = this.extractKeyTerms(answer);
    if (answerTerms.length === 0) {
      return { isGrounded: true, score: 1.0, unsupportedClaims: [] };
    }

    let supportedCount = 0;
    const unsupported: string[] = [];

    for (const term of answerTerms) {
      if (fullContext.includes(term.toLowerCase())) {
        supportedCount++;
      } else {
        unsupported.push(term);
      }
    }

    const score = supportedCount / answerTerms.length;
    const isGrounded = score >= this.minGroundingScore;

    log.debug(
      {
        totalKeyTerms: answerTerms.length,
        supportedCount,
        score: Math.round(score * 100) / 100,
        isGrounded,
      },
      'Grounding validation completed.'
    );

    let suggestedFallback: string | undefined;
    if (!isGrounded) {
      suggestedFallback =
        queryLanguage === 'ml'
          ? 'നിങ്ങൾ നൽകിയ പഠന സാമഗ്രികളിൽ ഈ ചോദ്യത്തിനുള്ള മതിയായ വിവരങ്ങൾ ലഭ്യമല്ല.'
          : 'The provided study materials do not contain sufficient information to answer this question accurately.';
    }

    return {
      isGrounded,
      score: Math.round(score * 100) / 100,
      unsupportedClaims: unsupported.slice(0, 10),
      suggestedFallback,
    };
  }

  private extractKeyTerms(text: string): string[] {
    // Match technical words, capitalized acronyms, numbers, and Malayalam word tokens
    const tokens = text
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => {
        if (t.length <= 3) return false;
        // Common stop words to exclude
        const stopWords = new Set([
          'this', 'that', 'with', 'from', 'have', 'more', 'also', 'some', 'they', 'them',
          'their', 'what', 'when', 'where', 'which', 'will', 'would', 'could', 'should',
          'these', 'those', 'about', 'there', 'because', 'between',
        ]);
        return !stopWords.has(t.toLowerCase());
      });

    return Array.from(new Set(tokens));
  }
}

export const groundingValidator = new GroundingValidator();
