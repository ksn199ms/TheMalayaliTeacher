import { GoogleGenAI } from '@google/genai';
import { AIProvider, GenerateTextOptions, AIProviderError } from './AIProvider.js';
import { geminiRequestManager } from './GeminiRequestManager.js';
import { GeminiAPIError } from './errors/GeminiError.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('gemini.provider');

export class GeminiProvider implements AIProvider {
  private ai: GoogleGenAI;
  private model: string;
  private apiKey: string;

  constructor(apiKey: string = config.GEMINI_API_KEY, model: string = config.GEMINI_MODEL) {
    this.apiKey = apiKey;
    this.model = this.resolveModel(model);
    this.ai = new GoogleGenAI({ apiKey: this.apiKey || 'unconfigured' });
  }

  /**
   * Resolves the fastest efficient Gemini 3.5 model name.
   * Defaults to gemini-3.5-flash-lite (fastest, lowest latency, highest limits).
   */
  private resolveModel(modelName?: string): string {
    const candidate = modelName?.trim();
    if (!candidate || candidate === 'gemini-2.5-flash' || candidate === 'gemini-3.6-flash' || candidate === 'gemini-3.8-flash') {
      return config.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    }
    return candidate;
  }

  private validateKey(): void {
    if (!this.apiKey || this.apiKey.trim() === '' || this.apiKey.includes('your_gemini_api_key')) {
      throw new AIProviderError(
        'GEMINI_API_KEY is not configured. Please add a valid Gemini API key from https://aistudio.google.com/ in your .env file.',
        'gemini',
        401
      );
    }
  }

  private formatContents(options: GenerateTextOptions): any[] {
    const contents: any[] = [];

    if (options.messages && options.messages.length > 0) {
      for (const msg of options.messages) {
        if (msg.role === 'system') continue; // system instruction handled separately in config
        contents.push({
          role: msg.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: msg.content }],
        });
      }
    } else if (options.prompt) {
      contents.push({
        role: 'user',
        parts: [{ text: options.prompt }],
      });
    }

    // If contents is empty, add a default fallback
    if (contents.length === 0) {
      contents.push({
        role: 'user',
        parts: [{ text: 'Hello' }],
      });
    }

    return contents;
  }

  /**
   * Calculates smart token bounds based on request type to avoid exceeding quota limits.
   */
  private getOptimalMaxTokens(options: GenerateTextOptions): number {
    if (options.maxTokens) return options.maxTokens;
    switch (options.requestType) {
      case 'summary':
        return 2048;
      case 'quiz':
      case 'flashcards':
        return 1500;
      case 'explain':
      case 'simplify':
        return 1024;
      case 'ocr':
        return 4096;
      case 'answer':
      default:
        return 1024;
    }
  }

  public async generateText(options: GenerateTextOptions): Promise<string> {
    this.validateKey();
    const primaryModel = this.resolveModel(this.model);
    const fallbackModel = primaryModel.includes('flash-lite')
      ? 'gemini-3.5-flash'
      : 'gemini-3.5-flash-lite';
    const maxOutputTokens = this.getOptimalMaxTokens(options);

    const context = options.requestContext || geminiRequestManager.createRequestContext(
      options.userId || 'system',
      (options.requestType as any) || 'answer'
    );

    try {
      return await geminiRequestManager.execute(context, async () => {
        let activeModel = primaryModel;
        log.debug({ model: activeModel, operation: context.operation }, 'Calling Gemini generateContent...');
        const contents = this.formatContents(options);

        const systemInstruction = options.systemPrompt
          ? { parts: [{ text: options.systemPrompt }] }
          : undefined;

        try {
          const response = await this.ai.models.generateContent({
            model: activeModel,
            contents,
            config: {
              systemInstruction,
              temperature: options.temperature ?? 0.2,
              maxOutputTokens,
              responseMimeType: options.responseFormat === 'json' ? 'application/json' : undefined,
            },
          });

          return response.text || '';
        } catch (firstErr: any) {
          // If first model hits a quota or rate-limit error, attempt seamless fallback to sibling 3.5 model
          const isRateLimit =
            firstErr?.status === 429 ||
            firstErr?.statusCode === 429 ||
            (typeof firstErr?.message === 'string' &&
              (firstErr.message.includes('429') ||
                firstErr.message.includes('RESOURCE_EXHAUSTED') ||
                firstErr.message.includes('Quota exceeded')));

          if (isRateLimit && fallbackModel && fallbackModel !== activeModel) {
            log.warn(
              { failedModel: activeModel, fallbackModel, error: firstErr.message },
              'Gemini 3.5 model rate limit reached. Seamlessly attempting fallback 3.5 model...'
            );
            activeModel = fallbackModel;
            const response = await this.ai.models.generateContent({
              model: activeModel,
              contents,
              config: {
                systemInstruction,
                temperature: options.temperature ?? 0.2,
                maxOutputTokens,
                responseMimeType: options.responseFormat === 'json' ? 'application/json' : undefined,
              },
            });
            return response.text || '';
          }
          throw firstErr;
        }
      });
    } catch (error: any) {
      log.error({ error: error.message }, 'Gemini generateText failed.');
      if (error instanceof GeminiAPIError) {
        throw new AIProviderError(error.message, 'gemini', error.info.httpStatus);
      }
      throw new AIProviderError(
        `Gemini generation error: ${error.message}`,
        'gemini',
        error.status || error.statusCode
      );
    }
  }

  public async *streamText(options: GenerateTextOptions): AsyncIterable<string> {
    this.validateKey();
    const primaryModel = this.resolveModel(this.model);
    const maxOutputTokens = this.getOptimalMaxTokens(options);

    try {
      log.debug({ model: primaryModel }, 'Calling Gemini generateContentStream...');
      const contents = this.formatContents(options);

      const systemInstruction = options.systemPrompt
        ? { parts: [{ text: options.systemPrompt }] }
        : undefined;

      const stream = await this.ai.models.generateContentStream({
        model: primaryModel,
        contents,
        config: {
          systemInstruction,
          temperature: options.temperature ?? 0.2,
          maxOutputTokens,
        },
      });

      for await (const chunk of stream) {
        if (chunk.text) {
          yield chunk.text;
        }
      }
    } catch (error: any) {
      log.error({ error: error.message }, 'Gemini streamText failed.');
      throw new AIProviderError(
        `Gemini streaming error: ${error.message}`,
        'gemini',
        error.status || error.statusCode
      );
    }
  }
}

export const geminiProvider = new GeminiProvider();
