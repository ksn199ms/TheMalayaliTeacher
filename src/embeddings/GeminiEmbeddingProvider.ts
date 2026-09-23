import { GoogleGenAI } from '@google/genai';
import { EmbeddingProvider } from './EmbeddingProvider.js';
import { geminiRequestManager } from '../ai/GeminiRequestManager.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('gemini.embedding');

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  private ai: GoogleGenAI;
  private model: string;
  private apiKey: string;
  private dimension: number = 768; // gemini-embedding-001 with outputDimensionality 768 default

  constructor(
    apiKey: string = config.GEMINI_API_KEY,
    model: string = config.GEMINI_EMBEDDING_MODEL
  ) {
    this.apiKey = apiKey;
    if (!model || model === 'text-embedding-004') {
      log.warn({ oldModel: model, newModel: 'gemini-embedding-001' }, 'Auto-migrating deprecated text-embedding-004 to gemini-embedding-001');
      this.model = 'gemini-embedding-001';
    } else {
      this.model = model;
    }
    this.ai = new GoogleGenAI({ apiKey: this.apiKey || 'unconfigured' });
  }

  public getDimension(): number {
    return this.dimension;
  }

  private validateKey(): void {
    if (!this.apiKey || this.apiKey.trim() === '' || this.apiKey.includes('your_gemini_api_key')) {
      throw new Error(
        'GEMINI_API_KEY is not configured. Please add a valid Gemini API key from https://aistudio.google.com/ in your .env file.'
      );
    }
  }

  public async embedQuery(text: string): Promise<number[]> {
    this.validateKey();
    const model = (!this.model || this.model.includes('text-embedding-004')) ? 'gemini-embedding-001' : this.model;
    
    const context = geminiRequestManager.createRequestContext('system', 'embedding', 10, 'HIGH');

    return await geminiRequestManager.execute(context, async () => {
      log.debug({ model }, 'Generating Gemini query embedding...');
      const response = await this.ai.models.embedContent({
        model,
        contents: text,
        config: {
          outputDimensionality: this.dimension,
        },
      });

      const values = response.embeddings?.[0]?.values || (response as any).embedding?.values;
      if (!values || values.length === 0) {
        throw new Error('Gemini embedding returned empty values.');
      }
      return values;
    });
  }

  public async embedDocuments(texts: string[]): Promise<number[][]> {
    if (!texts || texts.length === 0) return [];
    this.validateKey();

    const model = (!this.model || this.model.includes('text-embedding-004')) ? 'gemini-embedding-001' : this.model;
    log.debug({ model, count: texts.length }, 'Generating Gemini document embeddings...');

    const results: number[][] = [];
    const concurrency = 5;

    for (let i = 0; i < texts.length; i += concurrency) {
      const slice = texts.slice(i, i + concurrency);
      const batchPromises = slice.map(async (txt) => {
        const res = await this.ai.models.embedContent({
          model,
          contents: txt,
          config: {
            outputDimensionality: this.dimension,
          },
        });
        const values = res.embeddings?.[0]?.values || (res as any).embedding?.values;
        if (!values || values.length === 0) {
          throw new Error('Gemini embedding returned empty values for chunk.');
        }
        return values;
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }
}

export const geminiEmbeddingProvider = new GeminiEmbeddingProvider();
