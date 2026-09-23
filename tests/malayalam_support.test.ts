import { describe, it, expect } from 'vitest';
import { detectResponseLanguage, getLanguageInstruction } from '../src/utils/language.js';
import { cleanText } from '../src/ingestion/cleaner.js';
import { buildExplainPrompt } from '../src/prompts/explainPrompt.js';
import { buildAskPrompt } from '../src/prompts/askPrompt.js';

describe('V3: Malayalam & Multilingual Unicode Support Tests', () => {
  describe('1. Language Detection', () => {
    it('should detect English queries', () => {
      expect(detectResponseLanguage('What is database normalization?')).toBe('en');
      expect(detectResponseLanguage('Explain the difference between TCP and UDP')).toBe('en');
      expect(detectResponseLanguage('')).toBe('en');
    });

    it('should detect Malayalam queries via Unicode range U+0D00-U+0D7F', () => {
      expect(detectResponseLanguage('നോർമലൈസേഷൻ എന്താണ്?')).toBe('ml');
      expect(detectResponseLanguage('ഡാറ്റാബേസ് മാനേജ്‌മെന്റ് സിസ്റ്റം')).toBe('ml');
      expect(detectResponseLanguage('Explain Normalization in മലയാളം')).toBe('ml');
    });

    it('should provide correct language instruction in prompts', () => {
      const mlInstruction = getLanguageInstruction('ml');
      expect(mlInstruction).toContain('Malayalam');
      expect(mlInstruction).toContain('Normalization (നോർമലൈസേഷൻ)');

      const enInstruction = getLanguageInstruction('en');
      expect(enInstruction).toContain('English');
    });
  });

  describe('2. Malayalam Unicode Text Cleaner & Prompt Preservation', () => {
    it('should preserve Malayalam Unicode characters without corruption during cleaning', () => {
      const malayalamDoc = `
        ഡാറ്റാബേസ് നോർമലൈസേഷൻ (Database Normalization)

        ഡാറ്റാബേസിലെ അനാവശ്യ ഡാറ്റ ഒഴിവാക്കാനും ഡാറ്റയുടെ കൃത്യത ഉറപ്പാക്കാനുമുള്ള ഒരു രീതിയാണിത്.
        1NF, 2NF, 3NF എന്നിവയാണ് പ്രധാന ഘട്ടങ്ങൾ.
      `;

      const cleaned = cleanText(malayalamDoc);
      expect(cleaned).toContain('ഡാറ്റാബേസ് നോർമലൈസേഷൻ (Database Normalization)');
      expect(cleaned).toContain('1NF, 2NF, 3NF');
      expect(cleaned).not.toContain('\uFFFD'); // no replacement characters
    });

    it('should embed Malayalam instructions inside explain and ask prompts properly', () => {
      const context = 'നോർമലൈസേഷൻ ഡാറ്റാബേസിലെ അനാവശ്യ ഡാറ്റ കുറയ്ക്കുന്നു.';
      const concept = 'നോർമലൈസേഷൻ';

      const explainPrompt = buildExplainPrompt(context, concept, 'ml');
      expect(explainPrompt).toContain('Language Instruction:');
      expect(explainPrompt).toContain('Malayalam');
      expect(explainPrompt).toContain(concept);

      const askPrompt = buildAskPrompt(context, 'ഇതിന്റെ ഗുണങ്ങൾ എന്തൊക്കെയാണ്?', 'ml');
      expect(askPrompt).toContain('ഇതിന്റെ ഗുണങ്ങൾ എന്തൊക്കെയാണ്?');
      expect(askPrompt).toContain('Malayalam');
    });
  });
});
