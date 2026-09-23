import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { StudySessionService } from '../src/study/StudySessionService.js';
import { quizService } from '../src/study/QuizService.js';
import { flashcardService } from '../src/study/FlashcardService.js';
import { StudySession } from '../src/database/models/StudySession.js';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import { Types } from 'mongoose';

describe('V3: Interactive Quiz & Flashcard Session Lifecycle Tests', () => {
  const sessionService = new StudySessionService();
  const userId = new Types.ObjectId().toString();
  const docId = new Types.ObjectId().toString();

  beforeAll(async () => {
    await connectDatabase('mongodb://localhost:27017/student-rag-test');
    await StudySession.deleteMany({ userId: new Types.ObjectId(userId) });
  });

  afterAll(async () => {
    await StudySession.deleteMany({ userId: new Types.ObjectId(userId) });
    await disconnectDatabase();
  });

  describe('1. Quiz Session Execution & Grading', () => {
    it('should track answers, score, and complete quiz', async () => {
      const questions = [
        {
          question: 'What is 1NF?',
          options: ['Atomic values', 'Multiple values', 'No primary key', 'None'],
          correctAnswer: 0,
          explanation: '1NF requires atomic values in every column.',
          citations: [{ documentId: docId, fileName: 'DBMS.pdf', pageNumber: 2 }],
        },
        {
          question: 'What is 2NF?',
          options: ['Partial dependency', 'No partial dependency', 'No primary key', 'None'],
          correctAnswer: 1,
          explanation: '2NF removes partial functional dependencies.',
          citations: [{ documentId: docId, fileName: 'DBMS.pdf', pageNumber: 3 }],
        },
      ];

      // Create quiz session
      const session = await sessionService.createQuizSession(userId, [docId], questions, 'DBMS.pdf');
      expect(session.status).toBe('active');
      expect(session.score).toBe(0);
      expect(session.currentQuestion).toBe(0);

      const sessionId = session._id.toString();

      // Submit correct answer to Question 1
      const ans1 = await sessionService.recordQuizAnswer(sessionId, 0, 0);
      expect(ans1).not.toBeNull();
      expect(ans1?.isCorrect).toBe(true);
      expect(ans1?.session.score).toBe(1);
      expect(ans1?.session.currentQuestion).toBe(1);
      expect(ans1?.session.status).toBe('active');

      // Submit incorrect answer to Question 2
      const ans2 = await sessionService.recordQuizAnswer(sessionId, 1, 0); // correct is 1
      expect(ans2).not.toBeNull();
      expect(ans2?.isCorrect).toBe(false);
      expect(ans2?.correctAnswer).toBe(1);
      expect(ans2?.session.score).toBe(1);
      expect(ans2?.session.currentQuestion).toBe(2);
      expect(ans2?.session.status).toBe('completed');

      // Check results card
      const resultsCard = quizService.formatFinalResults(ans2!.session);
      expect(resultsCard).toContain('*Score:* 1/2');
      expect(resultsCard).toContain('*Accuracy:* 50%');
      expect(resultsCard).toContain('• Correct: 1');
      expect(resultsCard).toContain('• Incorrect: 1');
    });

    it('should return null when retrieving an expired session', async () => {
      // Create session with past expiration
      const expiredSession = await StudySession.create({
        userId: new Types.ObjectId(userId),
        type: 'quiz',
        documentIds: [new Types.ObjectId(docId)],
        status: 'active',
        currentQuestion: 0,
        totalQuestions: 1,
        score: 0,
        questions: [
          {
            question: 'Expired Q?',
            options: ['A', 'B', 'C', 'D'],
            correctAnswer: 0,
            explanation: 'Exp',
            citations: [],
          },
        ],
        expiresAt: new Date(Date.now() - 10000), // expired 10s ago
      });

      const active = await sessionService.getActiveSession(userId, expiredSession._id.toString());
      expect(active).toBeNull();
    });
  });

  describe('2. Flashcard Session Navigation', () => {
    it('should navigate next, previous, and toggle answer flip', async () => {
      const flashcards = [
        {
          front: 'Term 1',
          back: 'Definition 1',
          citations: [{ documentId: docId, fileName: 'Terms.pdf', pageNumber: 1 }],
        },
        {
          front: 'Term 2',
          back: 'Definition 2',
          citations: [{ documentId: docId, fileName: 'Terms.pdf', pageNumber: 2 }],
        },
      ];

      const session = await sessionService.createFlashcardSession(userId, [docId], flashcards, 'Terms.pdf');
      const sessionId = session._id.toString();
      expect(session.currentCard).toBe(0);
      expect(session.showingAnswer).toBe(false);

      // Flip card to show answer
      const flipped = await sessionService.updateFlashcardNav(sessionId, 0, true);
      expect(flipped?.showingAnswer).toBe(true);

      // Render flipped card
      const renderedFlipped = flashcardService.renderFlashcard(flipped!);
      expect(renderedFlipped.text).toContain('Definition 1');
      const flipBtn = renderedFlipped.keyboard.reply_markup.inline_keyboard[0][1];
      expect((flipBtn as any).text).toContain('Show Question');

      // Navigate to card 2 (resets answer)
      const nextCard = await sessionService.updateFlashcardNav(sessionId, 1, false);
      expect(nextCard?.currentCard).toBe(1);
      expect(nextCard?.showingAnswer).toBe(false);

      // Render next card front
      const renderedNext = flashcardService.renderFlashcard(nextCard!);
      expect(renderedNext.text).toContain('Term 2');
      expect(renderedNext.text).toContain('Show Answer');

      // Navigate back to card 1
      const prevCard = await sessionService.updateFlashcardNav(sessionId, 0, false);
      expect(prevCard?.currentCard).toBe(0);
    });
  });
});
