export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateTextOptions {
  prompt?: string;
  systemPrompt?: string;
  messages?: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  responseLanguage?: string;
  responseFormat?: 'text' | 'json';
  requestType?: 'answer' | 'summary' | 'explain' | 'keypoints' | 'simplify' | 'quiz' | 'flashcards' | 'query-expansion' | 'reranking' | 'grounding' | 'ocr' | 'embedding';
  userId?: string;
  requestContext?: any;
}

export class AIProviderError extends Error {
  public provider: string;
  public statusCode?: number;

  constructor(message: string, provider: string, statusCode?: number) {
    super(message);
    this.name = 'AIProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
  }
}

export interface AIProvider {
  generateText(options: GenerateTextOptions): Promise<string>;
  streamText(options: GenerateTextOptions): AsyncIterable<string>;
}
