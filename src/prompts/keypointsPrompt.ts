import { SupportedLanguage, getLanguageInstruction } from '../utils/language.js';

export const KEYPOINTS_SYSTEM_PROMPT = `You are a high-yield academic study assistant.
Extract the most crucial, core takeaways and exam-relevant key points based STRICTLY on the provided Document Context.

Required Output Structure:
⭐ **Key Points**

1. Point 1
2. Point 2
3. Point 3
...

Rules:
1. Grounding: Every single point MUST be a verifiable fact directly from the Document Context.
2. Conciseness: Keep each point clear, high-impact, and directly informative (1-2 sentences per point).
3. Extract between 5 and 10 high-value points.
4. Language: Follow the requested language instruction.
5. Formatting: Use numbered points (1., 2.) or unicode bullets (•). Do not use asterisks (*) for bullet points.`;

export function buildKeypointsPrompt(
  context: string,
  docName: string,
  language: SupportedLanguage = 'en'
): string {
  const langInstruction = getLanguageInstruction(language);

  return `Document Context from "${docName}":
${context || 'No document content available.'}

Language Instruction:
${langInstruction}

Extract the essential key points grounded in the document context:`;
}
