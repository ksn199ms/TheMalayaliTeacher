import { ICitation } from '../../database/models/Message.js';
import { RetrievedChunk } from '../retriever.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('citation.builder');

export class CitationBuilder {
  /**
   * Builds validated citations from retrieved chunks that were provided in the context.
   */
  public buildValidatedCitations(
    chunks: RetrievedChunk[],
    _generatedAnswer?: string
  ): ICitation[] {
    if (!chunks || chunks.length === 0) {
      return [];
    }

    const citationMap = new Map<string, ICitation>();

    for (const chunk of chunks) {
      const key = `${chunk.documentId}-${chunk.fileName}-${chunk.pageNumber ?? 'none'}`;

      if (!citationMap.has(key)) {
        // If an answer is provided, we can also check if any key phrases or words from the chunk appear in the answer
        citationMap.set(key, {
          documentId: chunk.documentId,
          fileName: chunk.fileName,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
        });
      }
    }

    const citations = Array.from(citationMap.values());
    log.debug({ count: citations.length }, 'Constructed validated citations.');
    return citations;
  }

  /**
   * Formats citations into Telegram Markdown
   */
  public formatTelegramCitations(citations: ICitation[]): string {
    if (!citations || citations.length === 0) {
      return '';
    }

    const lines = citations.map((c) => {
      const page = c.pageNumber !== undefined ? ` — Page ${c.pageNumber}` : '';
      return `• ${c.fileName}${page}`;
    });

    return `\n\n📚 *Sources:*\n${lines.join('\n')}`;
  }
}

export const citationBuilder = new CitationBuilder();
