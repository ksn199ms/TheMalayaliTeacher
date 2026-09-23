/**
 * Computes Recall@K: proportion of relevant items retrieved in top K.
 */
export function calculateRecallAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number
): number {
  if (relevantIds.length === 0) return 1.0;
  const topKRetrieved = new Set(retrievedIds.slice(0, k));
  let matched = 0;
  for (const id of relevantIds) {
    if (topKRetrieved.has(id)) {
      matched++;
    }
  }
  return matched / relevantIds.length;
}

/**
 * Computes Precision@K: proportion of top K retrieved items that are relevant.
 */
export function calculatePrecisionAtK(
  retrievedIds: string[],
  relevantIds: string[],
  k: number
): number {
  const topKRetrieved = retrievedIds.slice(0, k);
  if (topKRetrieved.length === 0) return 0.0;
  const relevantSet = new Set(relevantIds);
  let matched = 0;
  for (const id of topKRetrieved) {
    if (relevantSet.has(id)) {
      matched++;
    }
  }
  return matched / topKRetrieved.length;
}

/**
 * Computes Reciprocal Rank (RR): 1 / rank of first relevant item (1-indexed).
 */
export function calculateReciprocalRank(
  retrievedIds: string[],
  relevantIds: string[]
): number {
  if (relevantIds.length === 0) return 1.0;
  const relevantSet = new Set(relevantIds);
  for (let i = 0; i < retrievedIds.length; i++) {
    if (relevantSet.has(retrievedIds[i])) {
      return 1 / (i + 1);
    }
  }
  return 0.0;
}

/**
 * Computes Keyword Coverage: proportion of expected keywords present in retrieved text.
 */
export function calculateKeywordCoverage(
  text: string,
  keywords: string[]
): number {
  if (!keywords || keywords.length === 0) return 1.0;
  const textLower = text.toLowerCase();
  let matched = 0;
  for (const kw of keywords) {
    if (textLower.includes(kw.toLowerCase())) {
      matched++;
    }
  }
  return matched / keywords.length;
}

/**
 * Computes lexical grounding score: ratio of significant answer terms found in context.
 */
export function calculateGroundingScore(
  answer: string,
  context: string
): number {
  if (!answer || answer.trim() === '') return 0;
  if (!context || context.trim() === '') return 0;

  const contextLower = context.toLowerCase();
  const tokens = answer
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 3);

  const uniqueTokens = Array.from(new Set(tokens));
  if (uniqueTokens.length === 0) return 1.0;

  let matched = 0;
  for (const token of uniqueTokens) {
    if (contextLower.includes(token)) {
      matched++;
    }
  }

  return Math.round((matched / uniqueTokens.length) * 1000) / 1000;
}
