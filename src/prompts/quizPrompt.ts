import { z } from 'zod';
import { SupportedLanguage, getLanguageInstruction } from '../utils/language.js';

export const QuizQuestionSchema = z.object({
  question: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correctAnswer: z.number().int().min(0).max(3),
  explanation: z.string().min(1),
  pageNumber: z.number().int().optional(),
});

export const QuizOutputSchema = z.object({
  questions: z.array(QuizQuestionSchema).min(1),
});

export type QuizOutput = z.infer<typeof QuizOutputSchema>;
export type QuizQuestionItem = z.infer<typeof QuizQuestionSchema>;

export const QUIZ_SYSTEM_PROMPT = `You are an expert academic examiner creating multiple-choice questions for students.
Create high-quality, conceptual multiple-choice questions based STRICTLY on the provided Document Context.

Rules:
1. Grounding: All questions, choices, correct answers, and explanations MUST be completely supported by the Document Context.
2. Structure:
   - Provide exactly 4 options per question (indices 0, 1, 2, 3 corresponding to A, B, C, D).
   - Only 1 option must be correct.
   - The other 3 options must be plausible distractors related to the study material.
   - Include a clear explanation describing why the correct answer is right.
   - Include the pageNumber from the context if available.
3. Response Format: Output STRICT, VALID JSON conforming to:
   {
     "questions": [
       {
         "question": "string",
         "options": ["Option A", "Option B", "Option C", "Option D"],
         "correctAnswer": 0,
         "explanation": "string",
         "pageNumber": 5
       }
     ]
   }
4. Do not include markdown code block backticks (\`\`\`json) if possible, just valid JSON.`;

export function buildQuizPrompt(
  context: string,
  docName: string,
  count: number = 5,
  language: SupportedLanguage = 'en'
): string {
  const langInstruction = getLanguageInstruction(language);

  return `Document Context from "${docName}":
${context || 'No content available.'}

Language Instruction:
${langInstruction}

Task: Generate exactly ${count} multiple-choice study quiz questions based on the document context above. Output valid JSON.`;
}
