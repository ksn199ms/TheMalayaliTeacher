import { Schema, model, Document } from 'mongoose';

export type UserRole = 'student' | 'admin';

export interface IDailyUsage {
  date: string; // YYYY-MM-DD in UTC
  questionsCount: number;
  uploadsCount: number;
  studyGenerationsCount: number;
}

export interface IUser extends Document {
  telegramId: string;
  name?: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  role: UserRole;
  languagePreference: 'ml' | 'en';
  dailyUsage: IDailyUsage;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DailyUsageSchema = new Schema<IDailyUsage>(
  {
    date: {
      type: String,
      required: true,
      default: () => new Date().toISOString().slice(0, 10),
    },
    questionsCount: {
      type: Number,
      default: 0,
    },
    uploadsCount: {
      type: Number,
      default: 0,
    },
    studyGenerationsCount: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const UserSchema = new Schema<IUser>(
  {
    telegramId: {
      type: String,
      unique: true,
      required: true,
      index: true,
    },
    name: {
      type: String,
      trim: true,
    },
    username: {
      type: String,
      trim: true,
    },
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    role: {
      type: String,
      enum: ['student', 'admin'],
      default: 'student',
      index: true,
    },
    languagePreference: {
      type: String,
      enum: ['ml', 'en'],
      default: 'ml',
    },
    dailyUsage: {
      type: DailyUsageSchema,
      default: () => ({
        date: new Date().toISOString().slice(0, 10),
        questionsCount: 0,
        uploadsCount: 0,
        studyGenerationsCount: 0,
      }),
    },
    deletedAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const User = model<IUser>('User', UserSchema);
