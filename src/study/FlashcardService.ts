import { Markup } from 'telegraf';
import { qdrantService, QdrantService } from '../vector/qdrant.service.js';
import { documentService, DocumentService } from '../modules/documents/document.service.js';
import { ingestionService } from '../ingestion/ingestion.service.js';
import { studySessionService, StudySessionService } from './StudySessionService.js';
import { AIProvider } from '../ai/AIProvider.js';
import { AIFactory } from '../ai/ai.factory.js';
import {
  FLASHCARDS_SYSTEM_PROMPT,
  buildFlashcardsPrompt,
  FlashcardOutputSchema,
  FlashcardItem,
} from '../prompts/flashcardsPrompt.js';
import { IStudySession, IFlashcard } from '../database/models/StudySession.js';
import { detectResponseLanguage } from '../utils/language.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('flashcard.service');

export class FlashcardService {
  private qdrant: QdrantService;
  private docService: DocumentService;
  private sessionService: StudySessionService;
  private aiProvider: AIProvider;

  constructor(
    qdrantInstance?: QdrantService,
    docServiceInstance?: DocumentService,
    sessionServiceInstance?: StudySessionService,
    aiProviderInstance?: AIProvider
  ) {
    this.qdrant = qdrantInstance || qdrantService;
    this.docService = docServiceInstance || documentService;
    this.sessionService = sessionServiceInstance || studySessionService;
    this.aiProvider = aiProviderInstance || AIFactory.getProvider();
  }

  /**
   * Generates flashcards from a student's document and creates a StudySession
   */
  public async generateFlashcards(
    userId: string,
    documentId: string,
    count: number = 8,
    userQueryPrompt?: string
  ): Promise<IStudySession> {
    log.info({ userId, documentId, count }, 'Generating study flashcards...');

    const doc = await this.docService.getDocumentById(userId, documentId);
    if (!doc) {
      throw new Error('Document not found or access denied.');
    }

    const language = detectResponseLanguage(userQueryPrompt);

    // 1. Fetch document chunks
    let chunks = await this.qdrant.getDocumentChunks(
      userId,
      documentId,
      config.MAX_FLASHCARD_CONTEXT_CHUNKS
    );

    // Self-healing: If no chunks found, try re-indexing from storage on the fly
    if (chunks.length === 0) {
      log.info({ userId, documentId }, 'No chunks in vector store. Attempting automatic on-the-fly re-indexing...');
      const reindexed = await ingestionService.reindexDocument(doc);
      if (reindexed) {
        chunks = await this.qdrant.getDocumentChunks(
          userId,
          documentId,
          config.MAX_FLASHCARD_CONTEXT_CHUNKS
        );
      }
    }

    if (chunks.length === 0) {
      throw new Error('No indexed content found for this document.');
    }

    // 2. Assemble context
    const contextText = chunks
      .map((c) => (c.pageNumber !== undefined ? `[Page ${c.pageNumber}] ${c.text}` : c.text))
      .join('\n\n');

    // 3. Request structured JSON from AI provider
    const prompt = buildFlashcardsPrompt(contextText, doc.fileName, count, language);
    let rawResponse = await this.aiProvider.generateText({
      systemPrompt: FLASHCARDS_SYSTEM_PROMPT,
      prompt,
      temperature: 0.3,
      responseFormat: 'json',
      requestType: 'flashcards',
      userId,
    });

    rawResponse = rawResponse.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();

    // 4. Validate with Zod
    let parsedData: { flashcards: FlashcardItem[] };
    try {
      const json = JSON.parse(rawResponse);
      parsedData = FlashcardOutputSchema.parse(json);
    } catch (parseError: any) {
      log.warn({ error: parseError.message }, 'Failed to parse AI flashcard JSON.');
      throw new Error('Could not generate structured flashcards. Please try again.');
    }

    // 5. Transform to IFlashcard
    const flashcards: IFlashcard[] = parsedData.flashcards.slice(0, count).map((fc) => ({
      front: fc.front,
      back: fc.back,
      citations: [
        {
          documentId: doc._id.toString(),
          fileName: doc.fileName,
          pageNumber: fc.pageNumber,
        },
      ],
    }));

    // 6. Create active StudySession
    return this.sessionService.createFlashcardSession(
      userId,
      [documentId],
      flashcards,
      doc.fileName
    );
  }

  /**
   * Formats the current flashcard (front or back) with interactive inline keyboard
   */
  public renderFlashcard(session: IStudySession) {
    const cardIdx = session.currentCard;
    const card = session.flashcards[cardIdx];
    if (!card) throw new Error('Flashcard index out of bounds.');

    const sessionId = session._id.toString();
    const isBack = session.showingAnswer;

    let text = `🗂 *Flashcard ${cardIdx + 1}/${session.totalCards}*\n\n`;

    if (!isBack) {
      text += `*Question / Concept:*\n${card.front}\n\n_Press "Show Answer" to flip._`;
    } else {
      const citation = card.citations[0];
      const sourceLine = citation?.pageNumber !== undefined
        ? `• ${citation.fileName} — Page ${citation.pageNumber}`
        : citation ? `• ${citation.fileName}` : '';

      text += `*Answer / Definition:*\n${card.back}\n\n📖 *Source:*\n${sourceLine}`;
    }

    const prevButton = cardIdx > 0
      ? Markup.button.callback('⬅️ Prev', `fc:${sessionId}:nav:${cardIdx - 1}`)
      : Markup.button.callback('⏹️ Start', `fc:${sessionId}:noop`);

    const flipButton = Markup.button.callback(
      isBack ? '🔄 Show Question' : '🔄 Show Answer',
      `fc:${sessionId}:flip`
    );

    const nextButton = cardIdx < session.totalCards - 1
      ? Markup.button.callback('Next ➡️', `fc:${sessionId}:nav:${cardIdx + 1}`)
      : Markup.button.callback('🏁 Done', `fc:${sessionId}:done`);

    const keyboard = Markup.inlineKeyboard([
      [prevButton, flipButton, nextButton],
    ]);

    return {
      text,
      keyboard,
    };
  }
}

export const flashcardService = new FlashcardService();
