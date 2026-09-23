import { RetrievedChunk } from './retriever.js';
import { ICitation } from '../database/models/Message.js';

export interface FormattedContext {
  contextText: string;
  citations: ICitation[];
}

export class ContextBuilder {
  /**
   * Builds prompt context string and deduplicated citation objects from retrieved chunks
   */
  public buildContext(chunks: RetrievedChunk[]): FormattedContext {
    if (!chunks || chunks.length === 0) {
      return {
        contextText: '',
        citations: [],
      };
    }

    const contextParts: string[] = [];
    const citationMap = new Map<string, ICitation>();

    for (const chunk of chunks) {
      const pageInfo = chunk.pageNumber !== undefined ? ` (Page ${chunk.pageNumber})` : '';
      const headingInfo = chunk.heading ? ` | Heading: ${chunk.heading}` : '';
      const sectionInfo = chunk.section && chunk.section !== chunk.heading ? ` | Section: ${chunk.section}` : '';
      contextParts.push(
        `--- Document: ${chunk.fileName}${pageInfo}${headingInfo}${sectionInfo} ---\n${chunk.text}`
      );

      // Deduplicate citations by fileName + pageNumber
      const key = `${chunk.documentId}-${chunk.fileName}-${chunk.pageNumber ?? 'none'}`;
      if (!citationMap.has(key)) {
        citationMap.set(key, {
          documentId: chunk.documentId,
          fileName: chunk.fileName,
          pageNumber: chunk.pageNumber,
          chunkIndex: chunk.chunkIndex,
        });
      }
    }

    return {
      contextText: contextParts.join('\n\n'),
      citations: Array.from(citationMap.values()),
    };
  }

  /**
   * Formats citations into user-friendly Telegram text
   */
  public formatCitations(citations: ICitation[]): string {
    if (!citations || citations.length === 0) {
      return '';
    }

    const lines = citations.map((c) => {
      if (c.pageNumber !== undefined) {
        return `• ${c.fileName} — Page ${c.pageNumber}`;
      }
      return `• ${c.fileName}`;
    });

    return `\n\n📚 *Sources:*\n${lines.join('\n')}`;
  }
}

export const contextBuilder = new ContextBuilder();
