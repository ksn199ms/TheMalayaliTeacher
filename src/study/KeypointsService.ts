import { qdrantService, QdrantService } from '../vector/qdrant.service.js';
import { documentService, DocumentService } from '../modules/documents/document.service.js';
import { ingestionService } from '../ingestion/ingestion.service.js';
import { AIProvider } from '../ai/AIProvider.js';
import { AIFactory } from '../ai/ai.factory.js';
import { KEYPOINTS_SYSTEM_PROMPT, buildKeypointsPrompt } from '../prompts/keypointsPrompt.js';
import { detectResponseLanguage, SupportedLanguage } from '../utils/language.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('keypoints.service');

export interface KeypointsResult {
  keypointsText: string;
  documentName: string;
  pagesCovered?: number[];
  language: SupportedLanguage;
}

export class KeypointsService {
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

  public async extractKeypoints(
    userId: string,
    documentId: string,
    userQueryPrompt?: string
  ): Promise<KeypointsResult> {
    log.info({ userId, documentId }, 'Extracting grounded key points from document...');

    // 1. Verify document ownership
    const doc = await this.docService.getDocumentById(userId, documentId);
    if (!doc) {
      throw new Error('Document not found or access denied.');
    }

    const language = detectResponseLanguage(userQueryPrompt);

    // 2. Fetch sequential chunks for this document
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

    // 3. Assemble document context
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

    // 4. Generate key points using AI provider
    const prompt = buildKeypointsPrompt(contextText, doc.fileName, language);
    const rawKeypoints = await this.aiProvider.generateText({
      systemPrompt: KEYPOINTS_SYSTEM_PROMPT,
      prompt,
      temperature: 0.2,
      requestType: 'keypoints',
      userId,
    });

    // 5. Append verified source info
    let finalKeypoints = rawKeypoints.trim();
    const sortedPages = Array.from(pageSet).sort((a, b) => a - b);

    if (sortedPages.length > 0) {
      const pageStr = sortedPages.length === 1 ? `Page ${sortedPages[0]}` : `Pages ${sortedPages[0]}–${sortedPages[sortedPages.length - 1]}`;
      finalKeypoints += `\n\n📖 *Sources:*\n• ${doc.fileName} — ${pageStr}`;
    } else {
      finalKeypoints += `\n\n📖 *Sources:*\n• ${doc.fileName}`;
    }

    return {
      keypointsText: finalKeypoints,
      documentName: doc.fileName,
      pagesCovered: sortedPages.length > 0 ? sortedPages : undefined,
      language,
    };
  }
}

export const keypointsService = new KeypointsService();
