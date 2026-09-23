import { ScoredChunk } from '../retrieval/reranker.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('context.deduplicator');

export class ContextDeduplicator {
  private overlapThreshold: number;

  constructor(overlapThreshold: number = 0.80) {
    this.overlapThreshold = overlapThreshold;
  }

  /**
   * Removes near-duplicate or heavily overlapping chunks from the ranked candidate list.
   * Chunks higher in the ranked list are preserved over lower ones.
   */
  public deduplicate(chunks: ScoredChunk[]): ScoredChunk[] {
    if (!chunks || chunks.length <= 1) {
      return chunks;
    }

    const uniqueChunks: ScoredChunk[] = [];
    const tokenSets: Set<string>[] = [];

    for (const chunk of chunks) {
      const tokens = this.tokenize(chunk.text);

      let isDuplicate = false;
      for (let i = 0; i < tokenSets.length; i++) {
        const existingSet = tokenSets[i];
        const jaccard = this.calculateJaccardSimilarity(tokens, existingSet);

        if (jaccard >= this.overlapThreshold) {
          isDuplicate = true;
          log.debug(
            {
              duplicateDoc: chunk.fileName,
              chunkIndex: chunk.chunkIndex,
              existingDoc: uniqueChunks[i].fileName,
              existingIndex: uniqueChunks[i].chunkIndex,
              jaccardScore: Math.round(jaccard * 100) / 100,
            },
            'Filtered out overlapping chunk.'
          );
          break;
        }

        // Substring check: if 90%+ of shorter chunk is identical to longer chunk
        if (
          chunk.documentId === uniqueChunks[i].documentId &&
          Math.abs(chunk.chunkIndex - uniqueChunks[i].chunkIndex) <= 1
        ) {
          const cleanA = chunk.text.trim().toLowerCase();
          const cleanB = uniqueChunks[i].text.trim().toLowerCase();
          if (cleanA.includes(cleanB) || cleanB.includes(cleanA)) {
            isDuplicate = true;
            break;
          }
        }
      }

      if (!isDuplicate) {
        uniqueChunks.push(chunk);
        tokenSets.push(tokens);
      }
    }

    log.debug(
      { originalCount: chunks.length, remainingCount: uniqueChunks.length },
      'Deduplicated context chunks.'
    );

    return uniqueChunks;
  }

  private tokenize(text: string): Set<string> {
    const words = text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2);
    return new Set(words);
  }

  private calculateJaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
    if (setA.size === 0 || setB.size === 0) return 0;

    let intersectionSize = 0;
    for (const item of setA) {
      if (setB.has(item)) {
        intersectionSize++;
      }
    }

    const unionSize = setA.size + setB.size - intersectionSize;
    return unionSize === 0 ? 0 : intersectionSize / unionSize;
  }
}

export const contextDeduplicator = new ContextDeduplicator();
