import { qdrantService, QdrantService } from '../vector/qdrant.service.js';
import { documentService, DocumentService } from '../modules/documents/document.service.js';
import { ingestionService } from '../ingestion/ingestion.service.js';
import { AIProvider } from '../ai/AIProvider.js';
import { AIFactory } from '../ai/ai.factory.js';
import { SUMMARIZE_SYSTEM_PROMPT, buildSummarizePrompt } from '../prompts/summarizePrompt.js';
import { detectResponseLanguage, SupportedLanguage } from '../utils/language.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('summary.service');

export interface SummaryResult {
  summary: string;
  documentName: string;
  pagesCovered?: number[];
  language: SupportedLanguage;
}

export class SummaryService {
  private qdrant: QdrantService;
  private docService: DocumentService;
  private aiProvider: AIProvider;

  constructor(
    qdrantInstance?: QdrantService,
    docServiceInstance?: DocumentService,
    aiProviderInstance?: AIProvider
  ) {
    this.qdrant = qdrantInstance || qdrantService;
    this.docService = docServiceInstance || documentService;
    this.aiProvider = aiProviderInstance || AIFactory.getProvider();
  }

  public async summarizeDocument(
    userId: string,
    documentId: string,
    userQueryPrompt?: string
  ): Promise<SummaryResult> {
    log.info({ userId, documentId }, 'Generating structured document summary...');

    // 1. Verify document ownership
    const doc = await this.docService.getDocumentById(userId, documentId);
    if (!doc) {
      throw new Error('Document not found or access denied.');
    }

    const language = detectResponseLanguage(userQueryPrompt);

    // 2. Fetch sequential chunks for this document with strict userId isolation
    let chunks = await this.qdrant.getDocumentChunks(
      userId,
      documentId,
      config.MAX_SUMMARY_CONTEXT_CHUNKS
    );

    // Self-healing: If no chunks found, try re-indexing from storage on the fly
    if (chunks.length === 0) {
      log.info({ userId, documentId }, 'No chunks in vector store. Attempting automatic on-the-fly re-indexing...');
      const reindexed = await ingestionService.reindexDocument(doc);
      if (reindexed) {
        chunks = await this.qdrant.getDocumentChunks(
          userId,
          documentId,
          config.MAX_SUMMARY_CONTEXT_CHUNKS
        );
      }
    }

    if (chunks.length === 0) {
      throw new Error('No indexed content found for this document.');
    }

    // 3. Assemble document context text in sequential order
    const contextLines: string[] = [];
    const pageSet = new Set<number>();

    for (const chunk of chunks) {
      if (chunk.pageNumber !== undefined) {
        pageSet.add(chunk.pageNumber);
        contextLines.push(`[Page ${chunk.pageNumber}] ${chunk.text}`);
      } else {
        contextLines.push(chunk.text);
      }
    }

    const contextText = contextLines.join('\n\n');

    // 4. Generate structured summary
    const prompt = buildSummarizePrompt(contextText, doc.fileName, language);
    const rawSummary = await this.aiProvider.generateText({
      systemPrompt: SUMMARIZE_SYSTEM_PROMPT,
      prompt,
      temperature: 0.2,
      requestType: 'summary',
      userId,
    });

    // 5. Append clean verified source info without inventing page numbers
    let finalSummary = rawSummary.trim();
    const sortedPages = Array.from(pageSet).sort((a, b) => a - b);

    if (sortedPages.length > 0) {
      const pageStr = sortedPages.length === 1 ? `Page ${sortedPages[0]}` : `Pages ${sortedPages[0]}–${sortedPages[sortedPages.length - 1]}`;
      finalSummary += `\n\n📖 *Sources:*\n• ${doc.fileName} — ${pageStr}`;
    } else {
      finalSummary += `\n\n📖 *Sources:*\n• ${doc.fileName}`;
    }

    return {
      summary: finalSummary,
      documentName: doc.fileName,
      pagesCovered: sortedPages.length > 0 ? sortedPages : undefined,
      language,
    };
  }
}

export const summaryService = new SummaryService();
