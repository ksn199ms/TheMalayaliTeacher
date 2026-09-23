import { EmbeddingProvider } from './EmbeddingProvider.js';
import { geminiEmbeddingProvider } from './GeminiEmbeddingProvider.js';

export * from './EmbeddingProvider.js';
export * from './GeminiEmbeddingProvider.js';

export type EmbeddingService = EmbeddingProvider;

export class EmbeddingFactory {
  public static getProvider(_type?: 'gemini'): EmbeddingProvider {
    return geminiEmbeddingProvider;
  }
}

export class DefaultEmbeddingService implements EmbeddingProvider {
  private provider: EmbeddingProvider;

  constructor(provider?: EmbeddingProvider) {
    this.provider = provider || EmbeddingFactory.getProvider();
  }

  public getDimension(): number {
    return this.provider.getDimension();
  }

  public async embedDocuments(texts: string[]): Promise<number[][]> {
    return this.provider.embedDocuments(texts);
  }

  public async embedQuery(text: string): Promise<number[]> {
    return this.provider.embedQuery(text);
  }
}

export const embeddingService = new DefaultEmbeddingService();
