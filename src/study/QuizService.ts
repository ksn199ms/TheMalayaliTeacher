import { Markup } from 'telegraf';
import { qdrantService, QdrantService } from '../vector/qdrant.service.js';
import { documentService, DocumentService } from '../modules/documents/document.service.js';
import { ingestionService } from '../ingestion/ingestion.service.js';
import { studySessionService, StudySessionService } from './StudySessionService.js';
import { AIProvider } from '../ai/AIProvider.js';
import { AIFactory } from '../ai/ai.factory.js';
import {
  QUIZ_SYSTEM_PROMPT,
  buildQuizPrompt,
  QuizOutputSchema,
  QuizQuestionItem,
} from '../prompts/quizPrompt.js';
import { IStudySession, IQuizQuestion } from '../database/models/StudySession.js';
import { detectResponseLanguage } from '../utils/language.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('quiz.service');

export class QuizService {
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
   * Generates a quiz from a student's document and creates a StudySession
   */
  public async generateQuiz(
    userId: string,
    documentId: string,
    count: number = 5,
    userQueryPrompt?: string
  ): Promise<IStudySession> {
    log.info({ userId, documentId, count }, 'Generating multiple-choice quiz...');

    const doc = await this.docService.getDocumentById(userId, documentId);
    if (!doc) {
      throw new Error('Document not found or access denied.');
    }

    const language = detectResponseLanguage(userQueryPrompt);

    // 1. Fetch document chunks
    let chunks = await this.qdrant.getDocumentChunks(
      userId,
      documentId,
      config.MAX_QUIZ_CONTEXT_CHUNKS
    );

    // Self-healing: If no chunks found, try re-indexing from storage on the fly
    if (chunks.length === 0) {
      log.info({ userId, documentId }, 'No chunks in vector store. Attempting automatic on-the-fly re-indexing...');
      const reindexed = await ingestionService.reindexDocument(doc);
      if (reindexed) {
        chunks = await this.qdrant.getDocumentChunks(
          userId,
          documentId,
          config.MAX_QUIZ_CONTEXT_CHUNKS
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
    const prompt = buildQuizPrompt(contextText, doc.fileName, count, language);
    let rawResponse = await this.aiProvider.generateText({
      systemPrompt: QUIZ_SYSTEM_PROMPT,
      prompt,
      temperature: 0.3,
      responseFormat: 'json',
      requestType: 'quiz',
      userId,
    });

    // Clean any accidental markdown code block formatting
    rawResponse = rawResponse.replace(/```json\s*/gi, '').replace(/```\s*$/gi, '').trim();

    // 4. Validate with Zod
    let parsedData: { questions: QuizQuestionItem[] };
    try {
      const json = JSON.parse(rawResponse);
      parsedData = QuizOutputSchema.parse(json);
    } catch (parseError: any) {
      log.warn({ error: parseError.message }, 'Failed to parse AI quiz JSON. Retrying with repair...');
      // Safe fallback: try parsing questions array or throw friendly error
      throw new Error('Could not generate structured quiz questions. Please try again.');
    }

    // 5. Transform to IQuizQuestion
    const questions: IQuizQuestion[] = parsedData.questions.slice(0, count).map((q) => ({
      question: q.question,
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation,
      citations: [
        {
          documentId: doc._id.toString(),
          fileName: doc.fileName,
          pageNumber: q.pageNumber,
        },
      ],
    }));

    // 6. Create active StudySession
    return this.sessionService.createQuizSession(
      userId,
      [documentId],
      questions,
      doc.fileName
    );
  }

  /**
   * Formats the current question and returns the text and inline keyboard
   */
  public renderQuestion(session: IStudySession, questionIdx: number) {
    const q = session.questions[questionIdx];
    if (!q) throw new Error('Question index out of bounds.');

    const labels = ['A', 'B', 'C', 'D'];
    const optionsText = q.options
      .map((opt, i) => `*${labels[i]}.* ${opt}`)
      .join('\n');

    const message = `🧠 *Question ${questionIdx + 1}/${session.totalQuestions}*\n\n${q.question}\n\n${optionsText}\n\n_Select your answer:_`;

    const sessionId = session._id.toString();
    const buttons = [
      [
        Markup.button.callback('A', `quiz:${sessionId}:ans:0`),
        Markup.button.callback('B', `quiz:${sessionId}:ans:1`),
        Markup.button.callback('C', `quiz:${sessionId}:ans:2`),
        Markup.button.callback('D', `quiz:${sessionId}:ans:3`),
      ],
    ];

    return {
      text: message,
      keyboard: Markup.inlineKeyboard(buttons),
    };
  }

  /**
   * Formats answer feedback after student selects an option
   */
  public formatAnswerFeedback(
    isCorrect: boolean,
    correctAnswerIdx: number,
    explanation: string,
    citationDocName: string,
    citationPage?: number
  ): string {
    const labels = ['A', 'B', 'C', 'D'];
    const correctLetter = labels[correctAnswerIdx] || 'A';

    const sourceLine = citationPage !== undefined
      ? `• ${citationDocName} — Page ${citationPage}`
      : `• ${citationDocName}`;

    if (isCorrect) {
      return `✅ *Correct!*\n\n💡 *Explanation:*\n${explanation}\n\n📖 *Source:*\n${sourceLine}`;
    }

    return `❌ *Incorrect.*\n\n*Correct answer:* *${correctLetter}*\n\n💡 *Explanation:*\n${explanation}\n\n📖 *Source:*\n${sourceLine}`;
  }

  /**
   * Formats final quiz results card
   */
  public formatFinalResults(session: IStudySession): string {
    const total = session.totalQuestions;
    const score = session.score;
    const accuracy = Math.round((score / total) * 100);

    return `🎯 *Quiz Complete!*\n\n*Score:* ${score}/${total}\n*Accuracy:* ${accuracy}%\n\n📊 *Results:*\n• Correct: ${score}\n• Incorrect: ${total - score}\n\n_Keep studying!_ 📚`;
  }
}

export const quizService = new QuizService();
