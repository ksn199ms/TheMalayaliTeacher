import { ScoredChunk } from '../retrieval/reranker.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('context.compressor');

export interface CompressionOptions {
  maxChunks?: number;
  maxTotalChars?: number;
  preserveDocumentOrder?: boolean;
}

export class ContextCompressor {
  /**
   * Selects the most informative chunks, capping to maxChunks and maxTotalChars,
   * while balancing representation across documents.
   */
  public compress(chunks: ScoredChunk[], options: CompressionOptions = {}): ScoredChunk[] {
    if (!chunks || chunks.length === 0) {
      return [];
    }

    const maxChunks = options.maxChunks ?? config.FINAL_CONTEXT_CHUNKS;
    const maxTotalChars = options.maxTotalChars ?? 12000; // ~3000 tokens
    const preserveDocumentOrder = options.preserveDocumentOrder ?? true;

    // 1. Ensure balanced selection: prioritize highest-scoring chunks while preventing
    // a single document from dominating when other high-scoring documents exist.
    const selected: ScoredChunk[] = [];
    const docCounts = new Map<string, number>();
    let currentTotalChars = 0;

    for (const chunk of chunks) {
      if (selected.length >= maxChunks) {
        break;
      }

      const docCount = docCounts.get(chunk.documentId) || 0;
      // If we already have 3 chunks from this doc, and there are other docs available in remaining list, skip for diversity
      if (docCount >= 3 && chunks.some((c) => c.documentId !== chunk.documentId && !selected.includes(c))) {
        continue;
      }

      if (currentTotalChars + chunk.text.length > maxTotalChars && selected.length > 0) {
        log.debug(
          { currentTotalChars, chunkLength: chunk.text.length, maxTotalChars },
          'Context character budget reached; stopping chunk inclusion.'
        );
        break;
      }

      selected.push(chunk);
      docCounts.set(chunk.documentId, docCount + 1);
      currentTotalChars += chunk.text.length;
    }

    // Fallback: if we selected fewer than maxChunks due to diversity cap, fill in from remaining chunks
    if (selected.length < maxChunks) {
      for (const chunk of chunks) {
        if (selected.length >= maxChunks) break;
        if (!selected.includes(chunk)) {
          if (currentTotalChars + chunk.text.length <= maxTotalChars) {
            selected.push(chunk);
            currentTotalChars += chunk.text.length;
          }
        }
      }
    }

    // 2. Order chunks logically:
    // If chunks are from the same document, sort them by pageNumber and chunkIndex
    // so the context reads sequentially and coherent explanations are formed.
    if (preserveDocumentOrder) {
      selected.sort((a, b) => {
        if (a.documentId === b.documentId) {
          if (a.pageNumber !== undefined && b.pageNumber !== undefined && a.pageNumber !== b.pageNumber) {
            return a.pageNumber - b.pageNumber;
          }
          return a.chunkIndex - b.chunkIndex;
        }
        // Different documents: keep the one with higher final score first
        return b.finalScore - a.finalScore;
      });
    }

    log.debug(
      {
        inputChunks: chunks.length,
        selectedChunks: selected.length,
        totalChars: currentTotalChars,
      },
      'Context compression completed.'
    );

    return selected;
  }
}

export const contextCompressor = new ContextCompressor();
