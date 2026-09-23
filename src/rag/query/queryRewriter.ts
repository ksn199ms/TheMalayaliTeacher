import { QueryAnalyzer, QueryAnalysis } from './queryAnalyzer.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('query.rewriter');

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export class QueryRewriter {
  /**
   * Rewrites conversational follow-up queries using recent context to make them standalone for retrieval.
   * If query is already standalone, returns normalized query.
   */
  public static rewrite(
    query: string,
    history: ConversationTurn[],
    analysis?: QueryAnalysis
  ): { rewrittenQuery: string; wasRewritten: boolean } {
    const queryInfo = analysis || QueryAnalyzer.analyze(query);

    if (!queryInfo.isFollowUp || !history || history.length === 0) {
      return { rewrittenQuery: queryInfo.normalizedQuery, wasRewritten: false };
    }

    // Inspect last assistant response and last user question
    const recentAssistant = [...history].reverse().find((h) => h.role === 'assistant');
    const recentUser = [...history].reverse().find((h) => h.role === 'user');

    if (!recentAssistant && !recentUser) {
      return { rewrittenQuery: queryInfo.normalizedQuery, wasRewritten: false };
    }

    const assistantText = recentAssistant?.content || '';
    const userText = recentUser?.content || '';

    let rewritten = queryInfo.normalizedQuery;
    let resolvedEntity = '';

    // 1. Check for numbered list references (e.g. "What about the second one?", "Explain the 1st type")
    const orderMatch = query.match(/\b(?:the\s+)?(?:(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last))\b(?:\s+one|\s+type|\s+point|\s+property|\s+item)?/i);
    if (orderMatch && assistantText) {
      const ord = orderMatch[1].toLowerCase();
      let index = 0;
      if (ord.includes('first') || ord.includes('1st')) index = 1;
      else if (ord.includes('second') || ord.includes('2nd')) index = 2;
      else if (ord.includes('third') || ord.includes('3rd')) index = 3;
      else if (ord.includes('fourth') || ord.includes('4th')) index = 4;
      else if (ord.includes('fifth') || ord.includes('5th')) index = 5;

      // Look for numbered list in assistant's previous message (e.g. "1. Primary Key\n2. Candidate Key")
      const listMatches = Array.from(assistantText.matchAll(/(?:^|\n)\s*(?:[0-9]+[.)]|•|-)\s*([A-Za-z0-9 _\-\(\)]{3,40})/g));
      if (listMatches.length >= index && index > 0) {
        resolvedEntity = listMatches[index - 1][1].trim();
      }
    }

    // 2. Pronoun references ("it", "this", "that", "why?")
    if (!resolvedEntity && (userText || assistantText)) {
      // Find prominent subject from previous user question or title of assistant response
      const prevKeywords = QueryAnalyzer.extractKeywords(userText);
      if (prevKeywords.length > 0) {
        resolvedEntity = prevKeywords.join(' ');
      } else {
        // Look for bold header in assistant response: "**Normalization** is..."
        const boldMatch = assistantText.match(/\*\*([A-Za-z0-9 _\-]{3,35})\*\*/);
        if (boldMatch) {
          resolvedEntity = boldMatch[1].trim();
        }
      }
    }

    if (resolvedEntity) {
      // Replace pronoun or append entity
      if (/\b(?:it|this|that|its)\b/i.test(rewritten)) {
        rewritten = rewritten.replace(/\b(it|this|that|its)\b/gi, resolvedEntity);
      } else if (/\b(?:the (?:first|second|third|fourth|last) one)\b/i.test(rewritten)) {
        rewritten = rewritten.replace(/\b(?:the (?:first|second|third|fourth|last) one)\b/gi, resolvedEntity);
      } else if (rewritten.length < 20) {
        rewritten = `${rewritten} ${resolvedEntity}`.trim();
      }

      log.debug({ original: query, rewritten, resolvedEntity }, 'Follow-up query rewritten.');
      return { rewrittenQuery: rewritten, wasRewritten: true };
    }

    return { rewrittenQuery: queryInfo.normalizedQuery, wasRewritten: false };
  }
}

export function rewriteFollowUpQuery(
  query: string,
  history: ConversationTurn[],
  analysis?: QueryAnalysis
): string {
  const result = QueryRewriter.rewrite(query, history, analysis);
  return result.rewrittenQuery;
}

