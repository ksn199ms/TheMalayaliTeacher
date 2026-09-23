import { CandidateChunk } from './hybridRetriever.js';
import { AnalyzedQuery } from '../query/queryAnalyzer.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('reranker');

export interface ScoredChunk extends CandidateChunk {
  finalScore: number;
  scoreBreakdown: {
    vectorScore: number;
    keywordScore: number;
    headingScore: number;
    conceptScore: number;
  };
}

export interface RerankOptions {
  analyzedQuery: AnalyzedQuery;
  topK?: number;
}

export class LocalReranker {
  /**
   * Reranks candidate chunks using multi-factor deterministic scoring:
   * 1. Vector similarity (0.45)
   * 2. Exact keyword / term overlap (0.30)
   * 3. Heading / section relevance (0.15)
   * 4. Multi-concept coverage for comparisons / complex queries (0.10)
   */
  public rerank(candidates: CandidateChunk[], options: RerankOptions): ScoredChunk[] {
    if (!candidates || candidates.length === 0) {
      return [];
    }

    const { analyzedQuery, topK = config.FINAL_CONTEXT_CHUNKS } = options;

    if (!config.ENABLE_RERANKING) {
      log.debug('Reranking disabled via config; returning top candidates by initial score.');
      return candidates.slice(0, topK).map((c) => ({
        ...c,
        finalScore: c.score,
        scoreBreakdown: {
          vectorScore: c.score,
          keywordScore: 0,
          headingScore: 0,
          conceptScore: 0,
        },
      }));
    }

    const keywords = analyzedQuery.keywords.map((k) => k.toLowerCase());
    const concepts = analyzedQuery.concepts.map((c) => c.toLowerCase());
    const queryLower = analyzedQuery.normalizedQuery.toLowerCase();



    const scored: ScoredChunk[] = candidates.map((candidate) => {
      const textLower = candidate.text.toLowerCase();
      const headingLower = (candidate.heading || '').toLowerCase();
      const sectionLower = (candidate.section || '').toLowerCase();

      // 1. Vector Score [0..1]
      const normVectorScore = Math.max(0, Math.min(1, candidate.score));

      // 2. Exact Keyword Score [0..1]
      let matchedKeywordCount = 0;
      let totalKeywordOccurrences = 0;

      for (const kw of keywords) {
        if (textLower.includes(kw)) {
          matchedKeywordCount++;
          // Count occurrences capped at 5
          const occurrences = (textLower.match(new RegExp(`\\b${escapeRegExp(kw)}\\b`, 'gi')) || []).length;
          totalKeywordOccurrences += Math.min(occurrences, 5);
        }
      }

      const keywordCoverage = keywords.length > 0 ? matchedKeywordCount / keywords.length : 0;
      const occurrenceBonus = Math.min(totalKeywordOccurrences / (keywords.length * 3 || 1), 1);
      const exactPhraseBonus = textLower.includes(queryLower) ? 0.2 : 0;
      const keywordScore = Math.min(keywordCoverage * 0.7 + occurrenceBonus * 0.2 + exactPhraseBonus, 1.0);

      // 3. Heading / Section Score [0..1]
      let headingScore = 0;
      if (headingLower || sectionLower) {
        const fullHeader = `${headingLower} ${sectionLower}`;
        let headerMatches = 0;
        for (const kw of keywords) {
          if (fullHeader.includes(kw)) {
            headerMatches++;
          }
        }
        if (headerMatches > 0) {
          headingScore = Math.min(headerMatches / Math.max(keywords.length, 1), 1.0);
        }
        if (fullHeader.includes(queryLower)) {
          headingScore = 1.0;
        }
      }

      // 4. Multi-concept coverage score [0..1]
      let conceptScore = 0;
      if (concepts.length > 1) {
        let coveredConcepts = 0;
        for (const concept of concepts) {
          if (textLower.includes(concept) || headingLower.includes(concept)) {
            coveredConcepts++;
          }
        }
        conceptScore = coveredConcepts / concepts.length;
      } else if (concepts.length === 1 && textLower.includes(concepts[0])) {
        conceptScore = 1.0;
      }

      // Weights:
      // Vector: 0.45
      // Keyword: 0.30
      // Heading: 0.15
      // Concept: 0.10
      const finalScore =
        normVectorScore * 0.45 +
        keywordScore * 0.30 +
        headingScore * 0.15 +
        conceptScore * 0.10;

      return {
        ...candidate,
        finalScore: Math.round(finalScore * 10000) / 10000,
        scoreBreakdown: {
          vectorScore: Math.round(normVectorScore * 1000) / 1000,
          keywordScore: Math.round(keywordScore * 1000) / 1000,
          headingScore: Math.round(headingScore * 1000) / 1000,
          conceptScore: Math.round(conceptScore * 1000) / 1000,
        },
      };
    });

    // Sort descending by final composite score
    scored.sort((a, b) => b.finalScore - a.finalScore);

    log.debug(
      {
        totalCandidates: candidates.length,
        topScore: scored[0]?.finalScore,
        lowestScore: scored[scored.length - 1]?.finalScore,
      },
      'Reranked candidate chunks.'
    );

    return scored;
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const localReranker = new LocalReranker();
