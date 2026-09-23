import { Types } from 'mongoose';
import { User, IUser } from '../../database/models/User.js';
import { DocumentModel } from '../../database/models/Document.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('quota.service');

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  malayalamReason?: string;
  current: number;
  limit: number;
  resetInHours?: number;
}

export class QuotaService {
  private getTodayUtcString(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private getHoursUntilMidnightUtc(): number {
    const now = new Date();
    const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    const diffMs = midnight.getTime() - now.getTime();
    return Math.max(1, Math.ceil(diffMs / (1000 * 60 * 60)));
  }

  /**
   * Loads user and ensures dailyUsage has rolled over if it's a new day
   */
  private async getFreshUserWithDailyRollover(userId: string): Promise<IUser | null> {
    const user = await User.findById(userId);
    if (!user) return null;

    const today = this.getTodayUtcString();
    if (!user.dailyUsage || user.dailyUsage.date !== today) {
      user.dailyUsage = {
        date: today,
        questionsCount: 0,
        uploadsCount: 0,
        studyGenerationsCount: 0,
      };
      await user.save();
    }

    return user;
  }

  /**
   * Check total document count and daily upload quota
   */
  public async checkUploadQuota(userId: string): Promise<QuotaCheckResult> {
    // 1. Check total active document limit
    const totalDocs = await DocumentModel.countDocuments({
      userId: new Types.ObjectId(userId),
      deletedAt: { $exists: false },
    });

    if (totalDocs >= config.MAX_DOCUMENTS_PER_USER) {
      log.warn({ userId, totalDocs, limit: config.MAX_DOCUMENTS_PER_USER }, 'User reached max document storage limit.');
      return {
        allowed: false,
        reason: `You have reached the maximum document limit (${config.MAX_DOCUMENTS_PER_USER} documents). Please delete older documents using /docs to upload new ones.`,
        malayalamReason: `നിങ്ങളുടെ പരമാവധി ഡോക്യുമെന്റ് പരിധി (${config.MAX_DOCUMENTS_PER_USER}) കഴിഞ്ഞു. പുതിയവ അപ്‌ലോഡ് ചെയ്യാൻ /docs ഉപയോഗിച്ച് പഴയവ ഡിലീറ്റ് ചെയ്യുക.`,
        current: totalDocs,
        limit: config.MAX_DOCUMENTS_PER_USER,
      };
    }

    // 2. Check daily upload limit
    const user = await this.getFreshUserWithDailyRollover(userId);
    const dailyUploads = user?.dailyUsage?.uploadsCount || 0;
    const hoursLeft = this.getHoursUntilMidnightUtc();

    if (dailyUploads >= config.MAX_DAILY_DOCUMENT_UPLOADS) {
      log.warn({ userId, dailyUploads, limit: config.MAX_DAILY_DOCUMENT_UPLOADS }, 'Daily upload quota exceeded.');
      return {
        allowed: false,
        reason: `Daily upload limit reached (${config.MAX_DAILY_DOCUMENT_UPLOADS} uploads per day). Your limit resets in ${hoursLeft} hours.`,
        malayalamReason: `ഇന്നത്തെ അപ്‌ലോഡ് പരിധി കഴിഞ്ഞു (${config.MAX_DAILY_DOCUMENT_UPLOADS} ഡോക്യുമെന്റുകൾ). ${hoursLeft} മണിക്കൂറിനുള്ളിൽ ലിമിറ്റ് റീസെറ്റ് ആകും.`,
        current: dailyUploads,
        limit: config.MAX_DAILY_DOCUMENT_UPLOADS,
        resetInHours: hoursLeft,
      };
    }

    return {
      allowed: true,
      current: dailyUploads,
      limit: config.MAX_DAILY_DOCUMENT_UPLOADS,
    };
  }

  /**
   * Increment daily upload count
   */
  public async incrementUploadCount(userId: string): Promise<void> {
    const today = this.getTodayUtcString();
    await User.findByIdAndUpdate(userId, {
      $set: { 'dailyUsage.date': today },
      $inc: { 'dailyUsage.uploadsCount': 1 },
    });
  }

  /**
   * Check daily question quota
   */
  public async checkQuestionQuota(userId: string): Promise<QuotaCheckResult> {
    const user = await this.getFreshUserWithDailyRollover(userId);
    const dailyQuestions = user?.dailyUsage?.questionsCount || 0;
    const hoursLeft = this.getHoursUntilMidnightUtc();

    if (dailyQuestions >= config.MAX_DAILY_QUESTIONS) {
      log.warn({ userId, dailyQuestions, limit: config.MAX_DAILY_QUESTIONS }, 'Daily question quota exceeded.');
      return {
        allowed: false,
        reason: `Daily study question limit reached (${config.MAX_DAILY_QUESTIONS} questions per day). Your limit resets in ${hoursLeft} hours.`,
        malayalamReason: `ഇന്നത്തെ ചോദ്യങ്ങളുടെ പരിധി കഴിഞ്ഞു (${config.MAX_DAILY_QUESTIONS} ചോദ്യങ്ങൾ). ${hoursLeft} മണിക്കൂറിനുള്ളിൽ ലിമിറ്റ് റീസെറ്റ് ആകും.`,
        current: dailyQuestions,
        limit: config.MAX_DAILY_QUESTIONS,
        resetInHours: hoursLeft,
      };
    }

    return {
      allowed: true,
      current: dailyQuestions,
      limit: config.MAX_DAILY_QUESTIONS,
    };
  }

  /**
   * Increment daily question count
   */
  public async incrementQuestionCount(userId: string): Promise<void> {
    const today = this.getTodayUtcString();
    await User.findByIdAndUpdate(userId, {
      $set: { 'dailyUsage.date': today },
      $inc: { 'dailyUsage.questionsCount': 1 },
    });
  }

  /**
   * Check daily study generation quota (Quiz, Flashcards, Summary, Keypoints, etc.)
   */
  public async checkStudyGenerationQuota(userId: string): Promise<QuotaCheckResult> {
    const user = await this.getFreshUserWithDailyRollover(userId);
    const dailyGenerations = user?.dailyUsage?.studyGenerationsCount || 0;
    const hoursLeft = this.getHoursUntilMidnightUtc();

    if (dailyGenerations >= config.MAX_DAILY_STUDY_GENERATIONS) {
      log.warn({ userId, dailyGenerations, limit: config.MAX_DAILY_STUDY_GENERATIONS }, 'Daily study generation quota exceeded.');
      return {
        allowed: false,
        reason: `Daily study assistant generations limit reached (${config.MAX_DAILY_STUDY_GENERATIONS} generations per day). Your limit resets in ${hoursLeft} hours.`,
        malayalamReason: `ഇന്നത്തെ സ്റ്റഡി അസിസ്റ്റന്റ് ജനറേഷൻ പരിധി കഴിഞ്ഞു (${config.MAX_DAILY_STUDY_GENERATIONS} തവണ). ${hoursLeft} മണിക്കൂറിനുള്ളിൽ ലിമിറ്റ് റീസെറ്റ് ആകും.`,
        current: dailyGenerations,
        limit: config.MAX_DAILY_STUDY_GENERATIONS,
        resetInHours: hoursLeft,
      };
    }

    return {
      allowed: true,
      current: dailyGenerations,
      limit: config.MAX_DAILY_STUDY_GENERATIONS,
    };
  }

  /**
   * Increment daily study generation count
   */
  public async incrementStudyGenerationCount(userId: string): Promise<void> {
    const today = this.getTodayUtcString();
    await User.findByIdAndUpdate(userId, {
      $set: { 'dailyUsage.date': today },
      $inc: { 'dailyUsage.studyGenerationsCount': 1 },
    });
  }
}

export const quotaService = new QuotaService();
