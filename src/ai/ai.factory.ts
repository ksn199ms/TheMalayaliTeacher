import { AIProvider } from './AIProvider.js';
import { geminiProvider } from './GeminiProvider.js';

export type ProviderType = 'gemini';

export class AIFactory {
  public static getProvider(_type?: ProviderType): AIProvider {
    return geminiProvider;
  }
}

export function createAIProvider(): AIProvider {
  return AIFactory.getProvider();
}
