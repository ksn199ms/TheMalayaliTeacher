import { Retriever, retriever as defaultRetriever, RetrievedChunk } from './retriever.js';
import { ContextBuilder, contextBuilder as defaultContextBuilder } from './context-builder.js';
import { AIProvider, ChatMessage } from '../ai/AIProvider.js';
import { AIFactory } from '../ai/ai.factory.js';
import { SYSTEM_PROMPT, buildRAGPrompt } from './prompts.js';
import { ICitation } from '../database/models/Message.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('rag.service');

import { ragPipeline } from './pipeline/RAGPipeline.js';
import { GroundingResult } from './grounding/groundingValidator.js';

export interface RAGAnswerResult {
  answer: string;
  rawAnswer: string;
  citations: ICitation[];
  retrievedChunks: RetrievedChunk[];
  grounding?: GroundingResult;
  metadata?: {
    normalizedQuery?: string;
    rewrittenQuery?: string;
    queryLanguage?: string;
    candidateCount?: number;
    finalChunkCount?: number;
    executionTimeMs?: number;
  };
}

export interface AskQuestionOptions {
  userId: string;
  question: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  documentIds?: string[];
}

export class RAGService {
  private retriever: Retriever;
  private contextBuilder: ContextBuilder;
  private aiProvider: AIProvider;
  private isDefaultPipeline: boolean;

  constructor(
    retrieverInstance?: Retriever,
    contextBuilderInstance?: ContextBuilder,
    aiProviderInstance?: AIProvider
  ) {
    this.isDefaultPipeline = !retrieverInstance && !contextBuilderInstance;
    this.retriever = retrieverInstance || defaultRetriever;
    this.contextBuilder = contextBuilderInstance || defaultContextBuilder;
    this.aiProvider = aiProviderInstance || AIFactory.getProvider();
  }

  public async answerQuestion(options: AskQuestionOptions): Promise<RAGAnswerResult> {
    const { userId, question, conversationHistory = [], documentIds } = options;

    log.info({ userId, questionLength: question.length }, 'Processing student question with RAG pipeline...');

    // If using standard default components, run through the complete V4 RAG Pipeline
    if (this.isDefaultPipeline) {
      const pipelineResult = await ragPipeline.execute({
        userId,
        question,
        conversationHistory,
        documentIds,
        aiProvider: this.aiProvider,
      });

      return {
        answer: pipelineResult.answer,
        rawAnswer: pipelineResult.rawAnswer,
        citations: pipelineResult.citations,
        retrievedChunks: pipelineResult.retrievedChunks,
        grounding: pipelineResult.grounding,
        metadata: pipelineResult.metadata,
      };
    }

    // Fallback for custom injected retriever/builder in mock tests
    const chunks = await this.retriever.retrieve(question, {
      userId,
      documentIds,
      topK: config.TOP_K,
    });

    const { contextText, citations } = this.contextBuilder.buildContext(chunks);

    const messages: ChatMessage[] = [];
    const historyLimit = config.MAX_HISTORY_MESSAGES;
    const recentHistory = conversationHistory.slice(-historyLimit);

    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      });
    }

    messages.push({
      role: 'user',
      content: buildRAGPrompt(contextText, question),
    });

    const rawAnswer = await this.aiProvider.generateText({
      systemPrompt: SYSTEM_PROMPT,
      messages,
      temperature: 0.2,
      requestType: 'answer',
      userId,
    });

    let finalAnswer = rawAnswer.trim();
    if (citations.length > 0) {
      finalAnswer += this.contextBuilder.formatCitations(citations);
    }

    return {
      answer: finalAnswer,
      rawAnswer,
      citations,
      retrievedChunks: chunks,
    };
  }
}

export const ragService = new RAGService();
