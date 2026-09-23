import { z } from 'zod';
import { SupportedLanguage, getLanguageInstruction } from '../utils/language.js';

export const FlashcardItemSchema = z.object({
  front: z.string().min(1),
  back: z.string().min(1),
  pageNumber: z.number().int().optional(),
});

export const FlashcardOutputSchema = z.object({
  flashcards: z.array(FlashcardItemSchema).min(1),
});

export type FlashcardOutput = z.infer<typeof FlashcardOutputSchema>;
export type FlashcardItem = z.infer<typeof FlashcardItemSchema>;

export const FLASHCARDS_SYSTEM_PROMPT = `You are an expert academic tutor designing spaced-repetition flashcards for students.
Create high-yield, conceptual flashcards based STRICTLY on the provided Document Context.

Rules:
1. Grounding: Every flashcard front and back MUST be completely grounded in the Document Context.
2. Front: A concise question, term, theorem, or mechanism to be recalled.
3. Back: A clear, student-friendly explanation, definition, or key formula/steps.
4. Response Format: Output STRICT, VALID JSON conforming to:
   {
     "flashcards": [
       {
         "front": "What is ...?",
         "back": "...",
         "pageNumber": 3
       }
     ]
   }
5. Do not include markdown code block backticks (\`\`\`json) if possible, just valid JSON.`;

export function buildFlashcardsPrompt(
  context: string,
  docName: string,
  count: number = 8,
  language: SupportedLanguage = 'en'
): string {
  const langInstruction = getLanguageInstruction(language);

  return `Document Context from "${docName}":
${context || 'No content available.'}

Language Instruction:
${langInstruction}

Task: Generate ${count} high-yield study flashcards based on the document context above. Output valid JSON.`;
}
