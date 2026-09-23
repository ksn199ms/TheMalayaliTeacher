import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeQuery } from '../query/queryAnalyzer.js';
import { rewriteFollowUpQuery } from '../query/queryRewriter.js';
import { groundingValidator } from '../grounding/groundingValidator.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('rag.evaluator');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface BenchmarkCase {
  id: string;
  question: string;
  category: string;
  expectedIntent: string;
  expectedLanguage: 'en' | 'ml' | 'mixed';
  expectedKeywords: string[];
  expectedConcepts?: string[];
  isFollowUp?: boolean;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  expectedGrounding: boolean;
  expectedAnswerContains?: string[];
}

export interface EvaluationSummary {
  totalCases: number;
  intentAccuracy: number;
  languageAccuracy: number;
  followUpAccuracy: number;
  keywordMatchRate: number;
  groundingAccuracy: number;
  categoryBreakdown: Record<string, { count: number; passed: number }>;
}

export class RAGEvaluator {
  private datasetPath: string;

  constructor(datasetPath?: string) {
    this.datasetPath =
      datasetPath ||
      path.resolve(__dirname, '../../../tests/evaluation/golden-dataset.json');
  }

  public runEvaluation(): EvaluationSummary {
    const rawData = fs.readFileSync(this.datasetPath, 'utf-8');
    const cases: BenchmarkCase[] = JSON.parse(rawData);

    let correctIntent = 0;
    let correctLanguage = 0;
    let followUpEvaluated = 0;
    let correctFollowUp = 0;
    let totalKeywords = 0;
    let matchedKeywords = 0;
    let correctGrounding = 0;

    const categoryBreakdown: Record<string, { count: number; passed: number }> = {};

    for (const testCase of cases) {
      if (!categoryBreakdown[testCase.category]) {
        categoryBreakdown[testCase.category] = { count: 0, passed: 0 };
      }
      categoryBreakdown[testCase.category].count++;

      let casePassed = true;

      // 1. Analyze query
      const analyzed = analyzeQuery(testCase.question);

      // Intent check
      if (analyzed.intent === testCase.expectedIntent) {
        correctIntent++;
      } else {
        casePassed = false;
      }

      // Language check
      if (analyzed.language === testCase.expectedLanguage) {
        correctLanguage++;
      } else {
        casePassed = false;
      }

      // Keywords check
      const detectedLower = analyzed.keywords.map((k) => k.toLowerCase());
      for (const kw of testCase.expectedKeywords) {
        totalKeywords++;
        if (detectedLower.some((d) => d.includes(kw.toLowerCase()) || kw.toLowerCase().includes(d))) {
          matchedKeywords++;
        }
      }

      // Follow-up rewrite check
      if (testCase.isFollowUp && testCase.conversationHistory) {
        followUpEvaluated++;
        const rewritten = rewriteFollowUpQuery(testCase.question, testCase.conversationHistory);
        // The rewritten query should be longer or include context terms
        if (rewritten && rewritten !== testCase.question && rewritten.length > testCase.question.length) {
          correctFollowUp++;
        } else {
          casePassed = false;
        }
      }

      // Grounding check for out-of-scope questions (empty context should return isGrounded: false)
      if (!testCase.expectedGrounding) {
        const dummyAnswer = 'Some generic answer.';
        const result = groundingValidator.validateGrounding(dummyAnswer, [], testCase.expectedLanguage);
        if (!result.isGrounded) {
          correctGrounding++;
        } else {
          casePassed = false;
        }
      } else {
        correctGrounding++;
      }

      if (casePassed) {
        categoryBreakdown[testCase.category].passed++;
      }
    }

    const summary: EvaluationSummary = {
      totalCases: cases.length,
      intentAccuracy: Math.round((correctIntent / cases.length) * 100),
      languageAccuracy: Math.round((correctLanguage / cases.length) * 100),
      followUpAccuracy: followUpEvaluated > 0 ? Math.round((correctFollowUp / followUpEvaluated) * 100) : 100,
      keywordMatchRate: totalKeywords > 0 ? Math.round((matchedKeywords / totalKeywords) * 100) : 100,
      groundingAccuracy: Math.round((correctGrounding / cases.length) * 100),
      categoryBreakdown,
    };

    log.info(summary, 'RAG Evaluation completed.');
    return summary;
  }
}

// Allow direct execution
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const evaluator = new RAGEvaluator();
  const summary = evaluator.runEvaluation();
  console.table({
    'Total Cases': summary.totalCases,
    'Intent Accuracy (%)': summary.intentAccuracy,
    'Language Accuracy (%)': summary.languageAccuracy,
    'Follow-up Rewrite Accuracy (%)': summary.followUpAccuracy,
    'Keyword Match Rate (%)': summary.keywordMatchRate,
    'Grounding Accuracy (%)': summary.groundingAccuracy,
  });
  console.log('\nCategory Breakdown:');
  console.table(summary.categoryBreakdown);
}
