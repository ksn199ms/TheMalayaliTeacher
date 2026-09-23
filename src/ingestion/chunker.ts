import { config } from '../config/env.js';

export interface DocumentChunk {
  text: string;
  userId: string;
  documentId: string;
  fileName: string;
  pageNumber?: number;
  chunkIndex: number;
  heading?: string;
  section?: string;
  language?: string;
  indexVersion?: number;
}

export interface ChunkOptions {
  chunkSize?: number;
  chunkOverlap?: number;
}

export class ChunkingService {
  private defaultChunkSize: number;
  private defaultChunkOverlap: number;

  constructor(
    chunkSize: number = config.CHUNK_SIZE,
    chunkOverlap: number = config.CHUNK_OVERLAP
  ) {
    this.defaultChunkSize = chunkSize;
    this.defaultChunkOverlap = chunkOverlap;
  }

  /**
   * Approximate token count for a text string (~4 chars per token for English, conservative for unicode)
   */
  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 3.5);
  }

  /**
   * Chunks a single page or continuous block of text into overlapping semantic chunks
   */
  public chunkText(
    text: string,
    metadata: {
      userId: string;
      documentId: string;
      fileName: string;
      pageNumber?: number;
      heading?: string;
      section?: string;
      language?: string;
      indexVersion?: number;
    },
    options?: ChunkOptions
  ): DocumentChunk[] {
    const targetTokens = options?.chunkSize ?? this.defaultChunkSize;
    const overlapTokens = options?.chunkOverlap ?? this.defaultChunkOverlap;

    if (!text || text.trim().length === 0) {
      return [];
    }

    // Split text into semantic segments: paragraphs or headings
    const paragraphs = text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);

    const chunks: DocumentChunk[] = [];
    let currentChunkTokens = 0;
    let currentSegments: string[] = [];
    let chunkIndex = 0;
    let currentHeading = metadata.heading;

    const flushCurrent = () => {
      if (currentSegments.length === 0) return;
      const chunkText = currentSegments.join('\n\n').trim();
      if (chunkText.length > 0) {
        chunks.push({
          text: chunkText,
          userId: metadata.userId,
          documentId: metadata.documentId,
          fileName: metadata.fileName,
          pageNumber: metadata.pageNumber,
          chunkIndex: chunkIndex++,
          heading: currentHeading,
          section: metadata.section,
          language: metadata.language,
          indexVersion: metadata.indexVersion ?? config.INDEX_VERSION,
        });
      }

      // Calculate overlap: retain the tail segments that fit within overlapTokens
      let overlapAccumulator = 0;
      const retainedSegments: string[] = [];

      for (let i = currentSegments.length - 1; i >= 0; i--) {
        const seg = currentSegments[i];
        const segTokens = this.estimateTokens(seg);
        if (overlapAccumulator + segTokens <= overlapTokens) {
          retainedSegments.unshift(seg);
          overlapAccumulator += segTokens;
        } else {
          break;
        }
      }

      currentSegments = retainedSegments;
      currentChunkTokens = overlapAccumulator;
    };

    for (const paragraph of paragraphs) {
      // Heading detection: Markdown #, ##, ### or Unit/Chapter/Section markers
      const trimmed = paragraph.trim();
      const headingMatch = trimmed.match(/^(?:#{1,4}\s+|(?:\*{1,2})?(?:Chapter|Unit|Section|Module)\s+[0-9IVXLCDM]+[:\s\-]+)([^\n]+)/i);
      if (headingMatch && headingMatch[1]) {
        currentHeading = headingMatch[1].replace(/[*_#]/g, '').trim();
      }

      const paragraphTokens = this.estimateTokens(paragraph);

      // If a single paragraph is larger than targetTokens, split by sentences
      if (paragraphTokens > targetTokens) {
        // Flush what we have before processing giant paragraph
        if (currentSegments.length > 0) {
          flushCurrent();
        }

        const sentences = paragraph.split(/(?<=[.?!।\n])\s+/).filter(Boolean);
        for (const sentence of sentences) {
          const sentenceTokens = this.estimateTokens(sentence);

          // If a single sentence is still larger than targetTokens, hard split by character chunks
          if (sentenceTokens > targetTokens) {
            if (currentSegments.length > 0) flushCurrent();
            const charLimit = Math.floor(targetTokens * 3.5);
            const charOverlap = Math.floor(overlapTokens * 3.5);
            let start = 0;
            while (start < sentence.length) {
              const slice = sentence.slice(start, start + charLimit);
              chunks.push({
                text: slice.trim(),
                userId: metadata.userId,
                documentId: metadata.documentId,
                fileName: metadata.fileName,
                pageNumber: metadata.pageNumber,
                chunkIndex: chunkIndex++,
                heading: currentHeading,
                section: metadata.section,
                language: metadata.language,
                indexVersion: metadata.indexVersion ?? config.INDEX_VERSION,
              });
              start += Math.max(1, charLimit - charOverlap);
            }
          } else if (currentChunkTokens + sentenceTokens > targetTokens) {
            flushCurrent();
            currentSegments.push(sentence);
            currentChunkTokens += sentenceTokens;
          } else {
            currentSegments.push(sentence);
            currentChunkTokens += sentenceTokens;
          }
        }
      } else if (currentChunkTokens + paragraphTokens > targetTokens) {
        flushCurrent();
        currentSegments.push(paragraph);
        currentChunkTokens += paragraphTokens;
      } else {
        currentSegments.push(paragraph);
        currentChunkTokens += paragraphTokens;
      }
    }

    // Flush any remaining content
    if (currentSegments.length > 0) {
      const remainingText = currentSegments.join('\n\n').trim();
      // Ensure we don't create an exact duplicate of the previous chunk if it consists only of overlap
      if (chunks.length === 0 || chunks[chunks.length - 1].text !== remainingText) {
        chunks.push({
          text: remainingText,
          userId: metadata.userId,
          documentId: metadata.documentId,
          fileName: metadata.fileName,
          pageNumber: metadata.pageNumber,
          chunkIndex: chunkIndex++,
          heading: currentHeading,
          section: metadata.section,
          language: metadata.language,
          indexVersion: metadata.indexVersion ?? config.INDEX_VERSION,
        });
      }
    }

    return chunks;
  }
}

export const chunkingService = new ChunkingService();
