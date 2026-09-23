import { retriever, Retriever } from '../rag/retriever.js';
import { contextBuilder, ContextBuilder } from '../rag/context-builder.js';
import { AIProvider } from '../ai/AIProvider.js';
import { AIFactory } from '../ai/ai.factory.js';
import { EXPLAIN_SYSTEM_PROMPT, buildExplainPrompt } from '../prompts/explainPrompt.js';
import { detectResponseLanguage, SupportedLanguage } from '../utils/language.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';
import { ICitation } from '../database/models/Message.js';

const log = createChildLogger('explain.service');

export interface ExplainResult {
  explanation: string;
  rawText: string;
  citations: ICitation[];
  language: SupportedLanguage;
}

export class ExplainService {
  private retriever: Retriever;
  private contextBuilder: ContextBuilder;
  private aiProvider: AIProvider;

  constructor(
    retrieverInstance?: Retriever,
    contextBuilderInstance?: ContextBuilder,
    aiProviderInstance?: AIProvider
  ) {
    this.retriever = retrieverInstance || retriever;
    this.contextBuilder = contextBuilderInstance || contextBuilder;
    this.aiProvider = aiProviderInstance || AIFactory.getProvider();
  }

  public async explainConcept(userId: string, concept: string, documentIds?: string[]): Promise<ExplainResult> {
    log.info({ userId, concept }, 'Explaining concept grounded in student documents...');

    const language = detectResponseLanguage(concept);

    // 1. Retrieve top relevant chunks for the concept with userId isolation
    const chunks = await this.retriever.retrieve(concept, {
      userId,
      documentIds,
      topK: config.MAX_EXPLAIN_CONTEXT_CHUNKS,
    });

    // 2. Build context and citations
    const { contextText, citations } = this.contextBuilder.buildContext(chunks);

    // 3. Assemble prompt
    const prompt = buildExplainPrompt(contextText, concept, language);

    // 4. Generate explanation using active AI provider
    const rawText = await this.aiProvider.generateText({
      systemPrompt: EXPLAIN_SYSTEM_PROMPT,
      prompt,
      temperature: 0.2,
      requestType: 'explain',
      userId,
    });

    let finalExplanation = rawText.trim();
    if (citations.length > 0) {
      finalExplanation += this.contextBuilder.formatCitations(citations);
    }

    return {
      explanation: finalExplanation,
      rawText,
      citations,
      language,
    };
  }
}

export const explainService = new ExplainService();
