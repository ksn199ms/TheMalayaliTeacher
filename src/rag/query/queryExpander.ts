import { QueryAnalysis } from './queryAnalyzer.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('query.expander');

export class QueryExpander {
  // Common Malayalam technical term mappings for cross-lingual student retrieval
  private static ML_EN_TERMS: Record<string, string> = {
    'ഡാറ്റാബേസ്': 'database',
    'നോർമലൈസേഷൻ': 'normalization',
    'പ്രൈമറി കീ': 'primary key',
    'ഫോറിൻ കീ': 'foreign key',
    'ട്രാൻസാക്ഷൻ': 'transaction',
    'ഓപ്പറേറ്റിംഗ് സിസ്റ്റം': 'operating system',
    'നെറ്റ്‌വർക്ക്': 'network',
    'പ്രോട്ടോകോൾ': 'protocol',
    'അൽഗോരിതം': 'algorithm',
    'മെമ്മറി മാനേജ്മെന്റ്': 'memory management',
    'മെമ്മറി': 'memory',
    'മാനേജ്മെന്റ്': 'management',
    'പ്രോസസ്സ്': 'process',
    'സ്റ്റാക്ക്': 'stack',
    'ക്യൂ': 'queue',
    'വ്യത്യാസം': 'difference',
    'ഗുണങ്ങൾ': 'advantages',
    'ദോഷങ്ങൾ': 'disadvantages',
  };

  /**
   * Expands query into controlled search variations (max MAX_QUERY_EXPANSIONS)
   */
  public static expand(
    query: string,
    analysis: QueryAnalysis,
    maxExpansions: number = config.MAX_QUERY_EXPANSIONS,
    forceEnable: boolean = false
  ): string[] {
    if ((!config.ENABLE_QUERY_EXPANSION && !forceEnable) || maxExpansions <= 0) {
      return [query];
    }

    const expansions: Set<string> = new Set();
    expansions.add(query);

    // 1. Comparison & Multi-concept expansion: ensure both concepts are retrieved independently
    if (analysis.isComparison && analysis.concepts.length >= 2) {
      for (const concept of analysis.concepts.slice(0, 2)) {
        if (expansions.size < maxExpansions + 1) {
          expansions.add(concept);
        }
      }
    }

    // 2. Cross-lingual Malayalam -> English keyword expansion for English document retrieval
    if (analysis.language === 'ml' || analysis.language === 'mixed') {
      let crossLingualQuery = query;
      let hasReplacement = false;

      for (const [mlTerm, enTerm] of Object.entries(this.ML_EN_TERMS)) {
        if (crossLingualQuery.includes(mlTerm)) {
          crossLingualQuery = crossLingualQuery.replaceAll(mlTerm, enTerm);
          hasReplacement = true;
        }
      }

      if (hasReplacement && expansions.size < maxExpansions + 1) {
        expansions.add(crossLingualQuery);
      }
    }

    // 3. Keyword-dense variation if query has many filler words
    if (analysis.keywords.length >= 2 && expansions.size < maxExpansions + 1) {
      const keywordQuery = analysis.keywords.join(' ');
      if (keywordQuery.toLowerCase() !== query.toLowerCase()) {
        expansions.add(keywordQuery);
      }
    }

    const result = Array.from(expansions).slice(0, maxExpansions + 1);
    if (result.length > 1) {
      log.debug({ original: query, variations: result }, 'Query expanded for multi-angle retrieval.');
    }

    return result;
  }
}

export function expandQuery(
  query: string,
  analysis: QueryAnalysis,
  maxExpansions?: number,
  forceEnable?: boolean
): string[] {
  return QueryExpander.expand(query, analysis, maxExpansions, forceEnable);
}

