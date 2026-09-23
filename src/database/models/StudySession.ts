import { Schema, model, Document, Types } from 'mongoose';
import { ICitation, CitationSchema } from './Message.js';

export type StudySessionType = 'quiz' | 'flashcards' | 'summary' | 'explain' | 'keypoints' | 'simplify';
export type StudySessionStatus = 'active' | 'completed' | 'cancelled';

export interface IQuizQuestion {
  question: string;
  options: string[];
  correctAnswer: number; // 0-indexed (0=A, 1=B, 2=C, 3=D)
  explanation: string;
  citations: ICitation[];
}

export interface IQuizUserAnswer {
  questionIndex: number;
  selectedAnswer: number;
  isCorrect: boolean;
  answeredAt: Date;
}

export interface IFlashcard {
  front: string;
  back: string;
  citations: ICitation[];
}

export interface IStudySession extends Document {
  userId: Types.ObjectId;
  type: StudySessionType;
  documentIds: Types.ObjectId[];
  status: StudySessionStatus;

  // Quiz state
  currentQuestion: number;
  totalQuestions: number;
  score: number;
  questions: IQuizQuestion[];
  userAnswers: IQuizUserAnswer[];

  // Flashcard state
  currentCard: number;
  totalCards: number;
  showingAnswer: boolean;
  flashcards: IFlashcard[];

  // Metadata
  topic?: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const QuizQuestionSchema = new Schema<IQuizQuestion>(
  {
    question: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctAnswer: { type: Number, required: true },
    explanation: { type: String, required: true },
    citations: [CitationSchema],
  },
  { _id: false }
);

const QuizUserAnswerSchema = new Schema<IQuizUserAnswer>(
  {
    questionIndex: { type: Number, required: true },
    selectedAnswer: { type: Number, required: true },
    isCorrect: { type: Boolean, required: true },
    answeredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const FlashcardSchema = new Schema<IFlashcard>(
  {
    front: { type: String, required: true },
    back: { type: String, required: true },
    citations: [CitationSchema],
  },
  { _id: false }
);

const StudySessionSchema = new Schema<IStudySession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['quiz', 'flashcards', 'summary', 'explain', 'keypoints', 'simplify'],
      required: true,
      index: true,
    },
    documentIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Document',
      },
    ],
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled'],
      default: 'active',
      index: true,
    },

    // Quiz fields
    currentQuestion: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
    score: { type: Number, default: 0 },
    questions: [QuizQuestionSchema],
    userAnswers: [QuizUserAnswerSchema],

    // Flashcard fields
    currentCard: { type: Number, default: 0 },
    totalCards: { type: Number, default: 0 },
    showingAnswer: { type: Boolean, default: false },
    flashcards: [FlashcardSchema],

    topic: { type: String },
    expiresAt: {
      type: Date,
      required: true,
      index: { expires: 0 }, // MongoDB TTL auto-cleanup on expiration
    },
  },
  {
    timestamps: true,
  }
);

StudySessionSchema.index({ userId: 1, status: 1, type: 1 });

export const StudySession = model<IStudySession>('StudySession', StudySessionSchema);
