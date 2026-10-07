import { normalizeQuery } from '../query/queryNormalizer.js';
import { analyzeQuery, AnalyzedQuery } from '../query/queryAnalyzer.js';
import { rewriteFollowUpQuery } from '../query/queryRewriter.js';
import { expandQuery } from '../query/queryExpander.js';
import { hybridRetriever, CandidateChunk } from '../retrieval/hybridRetriever.js';
import { localReranker, ScoredChunk } from '../retrieval/reranker.js';
import { contextDeduplicator } from '../context/deduplicator.js';
import { contextCompressor } from '../context/compressor.js';
import { contextBuilder } from '../context-builder.js';
import { groundingValidator, GroundingResult } from '../grounding/groundingValidator.js';
import { citationBuilder } from '../citations/citationBuilder.js';
import { AIProvider, ChatMessage } from '../../ai/AIProvider.js';
import { AIFactory } from '../../ai/ai.factory.js';
import { SYSTEM_PROMPT, buildRAGPrompt } from '../prompts.js';
import { ICitation } from '../../database/models/Message.js';
import { RetrievedChunk } from '../retriever.js';
import { geminiDeduplicator } from '../../ai/cache/GeminiDeduplicator.js';
import { config } from '../../config/env.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('rag.pipeline');

export interface PipelineOptions {
  userId: string;
  question: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  documentIds?: string[];
  aiProvider?: AIProvider;
}

export interface PipelineResult {
  answer: string;
  rawAnswer: string;
  citations: ICitation[];
  retrievedChunks: RetrievedChunk[];
  grounding: GroundingResult;
  metadata: {
    normalizedQuery: string;
    rewrittenQuery?: string;
    queryLanguage: string;
    candidateCount: number;
    finalChunkCount: number;
    executionTimeMs: number;
  };
}

export class RAGPipeline {
  private defaultAiProvider: AIProvider;

  constructor(aiProvider?: AIProvider) {
    this.defaultAiProvider = aiProvider || AIFactory.getProvider();
  }

  /**
   * Executes the full V4 Advanced RAG & Intelligent Retrieval Pipeline:
   * 1. Query Normalization
   * 2. Query Analysis
   * 3. Contextual Follow-up Rewriting
   * 4. Controlled Expansion
   * 5. Hybrid Multi-query Retrieval
   * 6. Multi-factor Reranking
   * 7. Context Deduplication
   * 8. Context Compression & Ordering
   * 9. Gemini 3.8 Flash Generation
   * 10. Grounding Validation
   * 11. Citation Formatting
   */
  public async execute(options: PipelineOptions): Promise<PipelineResult> {
    const startTime = Date.now();
    const { userId, question, conversationHistory = [], documentIds } = options;
    const ai = options.aiProvider || this.defaultAiProvider;

    if (!userId || !question || question.trim() === '') {
      throw new Error('userId and question are required for RAG pipeline execution.');
    }

    log.info({ userId, questionLength: question.length }, 'V4 RAG Pipeline: Execution started.');

    // 1. Query Normalization
    const normalized = normalizeQuery(question);

    // Check user-scoped short-term cache for duplicate identical queries (zero API cost)
    if (conversationHistory.length === 0) {
      const cached = geminiDeduplicator.getCachedResponse(userId, normalized, documentIds);
      if (cached) {
        log.info({ userId, question: normalized }, 'Returning cached RAG answer (zero Gemini API calls used).');
        return {
          answer: cached,
          rawAnswer: cached,
          citations: [],
          retrievedChunks: [],
          grounding: {
            isGrounded: true,
            score: 1.0,
            groundedClaimsCount: 1,
            ungroundedClaimsCount: 0,
            citationIds: [],
          },
          metadata: {
            normalizedQuery: normalized,
            rewrittenQuery: undefined,
            queryLanguage: 'en',
            candidateCount: 0,
            finalChunkCount: 0,
            executionTimeMs: Date.now() - startTime,
          },
        };
      }
    }

    // 2. Query Analysis
    const analyzed: AnalyzedQuery = analyzeQuery(normalized);

    // 3. Follow-up Rewriting (if conversation history exists and query appears to be a follow-up)
    let retrievalQuery = normalized;
    let rewrittenQuery: string | undefined;

    if (conversationHistory.length > 0 && analyzed.isFollowUp) {
      rewrittenQuery = rewriteFollowUpQuery(normalized, conversationHistory);
      if (rewrittenQuery && rewrittenQuery !== normalized) {
        retrievalQuery = rewrittenQuery;
        log.debug({ original: normalized, rewritten: rewrittenQuery }, 'Rewrote follow-up query for retrieval.');
      }
    }

    // 4. Controlled Query Expansion
    const queryVariations = expandQuery(retrievalQuery, analyzed);

    if (config.RAG_DEBUG) {
      log.info(
        {
          normalized,
          rewrittenQuery,
          intent: analyzed.intent,
          language: analyzed.language,
          keywords: analyzed.keywords,
          concepts: analyzed.concepts,
          variations: queryVariations,
        },
        '[RAG_DEBUG] Query Processing Stage'
      );
    }

    // 5. Hybrid Retrieval across expanded queries with userId isolation
    const candidates: CandidateChunk[] = await hybridRetriever.retrieveCandidates(queryVariations, {
      userId,
      documentIds,
      candidatePoolSize: config.RETRIEVAL_CANDIDATES,
      scoreThreshold: config.SIMILARITY_THRESHOLD,
    });

    // 6. Local Reranking
    const reranked: ScoredChunk[] = localReranker.rerank(candidates, {
      analyzedQuery: analyzed,
      topK: config.RETRIEVAL_CANDIDATES,
    });

    // 7. Deduplication (>80% token overlap)
    const deduplicated: ScoredChunk[] = contextDeduplicator.deduplicate(reranked);

    // 8. Compression & Ordering (capped at FINAL_CONTEXT_CHUNKS, chronological order preserved)
    const finalChunks: ScoredChunk[] = contextCompressor.compress(deduplicated, {
      maxChunks: config.FINAL_CONTEXT_CHUNKS,
      preserveDocumentOrder: true,
    });

    const mappedRetrievedChunks: RetrievedChunk[] = finalChunks.map((c) => ({
      text: c.text,
      score: c.finalScore,
      documentId: c.documentId,
      fileName: c.fileName,
      pageNumber: c.pageNumber,
      chunkIndex: c.chunkIndex,
      heading: c.heading,
      section: c.section,
      language: c.language,
      indexVersion: c.indexVersion,
    }));

    // 9. Build prompt context
    const { contextText } = contextBuilder.buildContext(mappedRetrievedChunks);

    // Build chat message payload for Gemini
    const messages: ChatMessage[] = [];
    const recentHistory = conversationHistory.slice(-config.MAX_HISTORY_MESSAGES);

    for (const msg of recentHistory) {
      messages.push({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      });
    }

    // Always use the student's original natural question in the prompt to preserve tone & voice
    messages.push({
      role: 'user',
      content: buildRAGPrompt(contextText, question),
    });

    // 10. Generation via Gemini 3.5 Flash-Lite (Fastest)
    const rawAnswer = await ai.generateText({
      systemPrompt: SYSTEM_PROMPT,
      messages,
      temperature: 0.2,
      maxTokens: 1024,
      requestType: 'answer',
      userId,
    });

    // 11. Grounding Validation
    const grounding: GroundingResult = groundingValidator.validateGrounding(
      rawAnswer,
      mappedRetrievedChunks,
      analyzed.language
    );

    let finalAnswerText = rawAnswer.trim();

    // If grounding check detected ungrounded hallucination and suggested a fallback
    if (!grounding.isGrounded && grounding.suggestedFallback && mappedRetrievedChunks.length === 0) {
      finalAnswerText = grounding.suggestedFallback;
    }

    // 12. Citation Validation and Formatting
    const validatedCitations: ICitation[] = citationBuilder.buildValidatedCitations(
      mappedRetrievedChunks,
      finalAnswerText
    );

    if (validatedCitations.length > 0 && !finalAnswerText.includes('📚 *Sources:*')) {
      finalAnswerText += citationBuilder.formatTelegramCitations(validatedCitations);
    }

    // Store in short-term cache for zero-overhead repeat queries
    if (conversationHistory.length === 0 && finalAnswerText) {
      geminiDeduplicator.setCachedResponse(userId, normalized, finalAnswerText, documentIds);
    }

    const executionTimeMs = Date.now() - startTime;

    if (config.RAG_DEBUG) {
      log.info(
        {
          executionTimeMs,
          candidateCount: candidates.length,
          rerankedCount: reranked.length,
          finalChunkCount: finalChunks.length,
          citationsCount: validatedCitations.length,
          groundingScore: grounding.score,
          isGrounded: grounding.isGrounded,
        },
        '[RAG_DEBUG] Pipeline Performance Telemetry'
      );
    }

    return {
      answer: finalAnswerText,
      rawAnswer,
      citations: validatedCitations,
      retrievedChunks: mappedRetrievedChunks,
      grounding,
      metadata: {
        normalizedQuery: normalized,
        rewrittenQuery,
        queryLanguage: analyzed.language,
        candidateCount: candidates.length,
        finalChunkCount: finalChunks.length,
        executionTimeMs,
      },
    };
  }
}

export const ragPipeline = new RAGPipeline();
