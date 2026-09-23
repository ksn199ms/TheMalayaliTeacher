import { Types } from 'mongoose';
import {
  StudySession,
  IStudySession,
  IQuizQuestion,
  IFlashcard,
} from '../database/models/StudySession.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('study.session');

export class StudySessionService {
  /**
   * Calculates the expiration date based on config TTL
   */
  private getExpirationDate(): Date {
    const ttlMinutes = config.STUDY_SESSION_TTL_MINUTES || 60;
    return new Date(Date.now() + ttlMinutes * 60 * 1000);
  }

  /**
   * Create an active quiz session
   */
  public async createQuizSession(
    userId: string,
    documentIds: string[],
    questions: IQuizQuestion[],
    topic?: string
  ): Promise<IStudySession> {
    // Cancel any existing active quiz sessions for this user to keep UX clean
    await StudySession.updateMany(
      { userId: new Types.ObjectId(userId), type: 'quiz', status: 'active' },
      { status: 'cancelled' }
    );

    const session = await StudySession.create({
      userId: new Types.ObjectId(userId),
      type: 'quiz',
      documentIds: documentIds.map((id) => new Types.ObjectId(id)),
      status: 'active',
      currentQuestion: 0,
      totalQuestions: questions.length,
      score: 0,
      questions,
      userAnswers: [],
      topic,
      expiresAt: this.getExpirationDate(),
    });

    log.info({ userId, sessionId: session._id.toString(), questionCount: questions.length }, 'Created active quiz session.');
    return session;
  }

  /**
   * Create an active flashcard session
   */
  public async createFlashcardSession(
    userId: string,
    documentIds: string[],
    flashcards: IFlashcard[],
    topic?: string
  ): Promise<IStudySession> {
    // Cancel any existing active flashcard sessions for this user
    await StudySession.updateMany(
      { userId: new Types.ObjectId(userId), type: 'flashcards', status: 'active' },
      { status: 'cancelled' }
    );

    const session = await StudySession.create({
      userId: new Types.ObjectId(userId),
      type: 'flashcards',
      documentIds: documentIds.map((id) => new Types.ObjectId(id)),
      status: 'active',
      currentCard: 0,
      totalCards: flashcards.length,
      showingAnswer: false,
      flashcards,
      topic,
      expiresAt: this.getExpirationDate(),
    });

    log.info({ userId, sessionId: session._id.toString(), cardCount: flashcards.length }, 'Created active flashcard session.');
    return session;
  }

  /**
   * Retrieves a session enforcing strict user isolation and TTL expiration
   */
  public async getActiveSession(userId: string, sessionId: string): Promise<IStudySession | null> {
    if (!Types.ObjectId.isValid(sessionId) || !Types.ObjectId.isValid(userId)) {
      return null;
    }

    const session = await StudySession.findOne({
      _id: new Types.ObjectId(sessionId),
      userId: new Types.ObjectId(userId),
    });

    if (!session) {
      log.warn({ userId, sessionId }, 'Study session not found or ownership mismatch.');
      return null;
    }

    // Check TTL expiration
    if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
      log.info({ sessionId }, 'Study session expired.');
      session.status = 'cancelled';
      await session.save();
      return null;
    }

    return session;
  }

  /**
   * Records a user's answer to a quiz question
   */
  public async recordQuizAnswer(
    sessionId: string,
    questionIndex: number,
    selectedAnswer: number
  ): Promise<{ session: IStudySession; isCorrect: boolean; correctAnswer: number; explanation: string } | null> {
    const session = await StudySession.findById(sessionId);
    if (!session || session.status !== 'active') return null;

    const question = session.questions[questionIndex];
    if (!question) return null;

    const isCorrect = question.correctAnswer === selectedAnswer;
    if (isCorrect) {
      session.score += 1;
    }

    session.userAnswers.push({
      questionIndex,
      selectedAnswer,
      isCorrect,
      answeredAt: new Date(),
    });

    session.currentQuestion = questionIndex + 1;
    if (session.currentQuestion >= session.totalQuestions) {
      session.status = 'completed';
    }

    await session.save();

    return {
      session,
      isCorrect,
      correctAnswer: question.correctAnswer,
      explanation: question.explanation,
    };
  }

  /**
   * Updates flashcard navigation and toggle state
   */
  public async updateFlashcardNav(
    sessionId: string,
    targetCard: number,
    showingAnswer: boolean
  ): Promise<IStudySession | null> {
    const session = await StudySession.findById(sessionId);
    if (!session || session.status !== 'active') return null;

    if (targetCard >= 0 && targetCard < session.totalCards) {
      session.currentCard = targetCard;
    }
    session.showingAnswer = showingAnswer;
    await session.save();
    return session;
  }
}

export const studySessionService = new StudySessionService();
