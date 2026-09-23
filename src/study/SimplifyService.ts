import { retriever, Retriever } from '../rag/retriever.js';
import { contextBuilder, ContextBuilder } from '../rag/context-builder.js';
import { AIProvider } from '../ai/AIProvider.js';
import { AIFactory } from '../ai/ai.factory.js';
import { SIMPLIFY_SYSTEM_PROMPT, buildSimplifyPrompt } from '../prompts/simplifyPrompt.js';
import { detectResponseLanguage, SupportedLanguage } from '../utils/language.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';
import { ICitation } from '../database/models/Message.js';

const log = createChildLogger('simplify.service');

export interface SimplifyResult {
  simplifiedText: string;
  rawText: string;
  citations: ICitation[];
  language: SupportedLanguage;
}

export class SimplifyService {
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

  public async simplifyConcept(userId: string, concept: string, documentIds?: string[]): Promise<SimplifyResult> {
    log.info({ userId, concept }, 'Simplifying concept with analogies grounded in student documents...');

    const language = detectResponseLanguage(concept);

    // 1. Retrieve top chunks for the concept with userId isolation
    const chunks = await this.retriever.retrieve(concept, {
      userId,
      documentIds,
      topK: config.MAX_EXPLAIN_CONTEXT_CHUNKS,
    });

    // 2. Build context and citations
    const { contextText, citations } = this.contextBuilder.buildContext(chunks);

    // 3. Assemble prompt
    const prompt = buildSimplifyPrompt(contextText, concept, language);

    // 4. Generate simplified explanation using active AI provider
    const rawText = await this.aiProvider.generateText({
      systemPrompt: SIMPLIFY_SYSTEM_PROMPT,
      prompt,
      temperature: 0.3,
      requestType: 'simplify',
      userId,
    });

    let finalSimplified = rawText.trim();
    if (citations.length > 0) {
      finalSimplified += this.contextBuilder.formatCitations(citations);
    }

    return {
      simplifiedText: finalSimplified,
      rawText,
      citations,
      language,
    };
  }
}

export const simplifyService = new SimplifyService();
