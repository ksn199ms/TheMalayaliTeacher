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
    if (!model || model === 'gemini-2.5-flash' || model === 'gemini-3.6-flash') {
      this.model = 'gemini-3.8-flash';
    } else {
      this.model = model;
    }
    this.ai = new GoogleGenAI({ apiKey: this.apiKey || 'unconfigured' });
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

  public async generateText(options: GenerateTextOptions): Promise<string> {
    this.validateKey();
    const model = (!this.model || this.model.includes('gemini-2.5-flash') || this.model.includes('gemini-3.6-flash')) ? 'gemini-3.8-flash' : this.model;

    const context = options.requestContext || geminiRequestManager.createRequestContext(
      options.userId || 'system',
      (options.requestType as any) || 'answer'
    );

    try {
      return await geminiRequestManager.execute(context, async () => {
        log.debug({ model, operation: context.operation }, 'Calling Gemini generateContent...');
        const contents = this.formatContents(options);

        const systemInstruction = options.systemPrompt
          ? { parts: [{ text: options.systemPrompt }] }
          : undefined;

        const response = await this.ai.models.generateContent({
          model,
          contents,
          config: {
            systemInstruction,
            temperature: options.temperature ?? 0.2,
            maxOutputTokens: options.maxTokens,
            responseMimeType: options.responseFormat === 'json' ? 'application/json' : undefined,
          },
        });

        return response.text || '';
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
    const model = (!this.model || this.model.includes('gemini-2.5-flash') || this.model.includes('gemini-3.6-flash')) ? 'gemini-3.8-flash' : this.model;

    try {
      log.debug({ model }, 'Calling Gemini generateContentStream...');
      const contents = this.formatContents(options);

      const systemInstruction = options.systemPrompt
        ? { parts: [{ text: options.systemPrompt }] }
        : undefined;

      const stream = await this.ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction,
          temperature: options.temperature ?? 0.2,
          maxOutputTokens: options.maxTokens,
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
