import { describe, it, expect } from 'vitest';
import { formatToTelegramHtml, stripMarkdown, splitTelegramMessage } from '../src/utils/telegram.js';

describe('Telegram Message Formatting & Asterisk Cleanup', () => {
  describe('formatToTelegramHtml', () => {
    it('should convert **bold** text to <b>bold</b> and remove asterisks', () => {
      const input = 'This is **very important** and **crucial** for the exam.';
      const output = formatToTelegramHtml(input);

      expect(output).toBe('This is <b>very important</b> and <b>crucial</b> for the exam.');
      expect(output).not.toContain('*');
    });

    it('should convert asterisk bullet points (*) to unicode bullets (•)', () => {
      const input = `Here are the key points:
* First concept
* Second concept
  * Nested concept`;

      const output = formatToTelegramHtml(input);

      expect(output).toContain('• First concept');
      expect(output).toContain('• Second concept');
      expect(output).toContain('  • Nested concept');
      expect(output).not.toContain('*');
    });

    it('should convert mixed bold bullets like * **Term**: definition', () => {
      const input = `* **Normalization:** Organizes data in database.
* **1NF:** Eliminates repeating groups.
* **2NF:** Eliminates partial dependencies.`;

      const output = formatToTelegramHtml(input);

      expect(output).toContain('• <b>Normalization:</b> Organizes data in database.');
      expect(output).toContain('• <b>1NF:</b> Eliminates repeating groups.');
      expect(output).toContain('• <b>2NF:</b> Eliminates partial dependencies.');
      expect(output).not.toContain('*');
    });

    it('should convert markdown headers (#, ##, ###) to bold tags', () => {
      const input = `### Operating Systems
## Process Management
# Overview`;

      const output = formatToTelegramHtml(input);

      expect(output).toContain('<b>Operating Systems</b>');
      expect(output).toContain('<b>Process Management</b>');
      expect(output).toContain('<b>Overview</b>');
    });

    it('should convert legacy *Sources:* or single asterisk headers to bold', () => {
      const input = `Explanation of topic.

📚 *Sources:*
• document.pdf — Page 5`;

      const output = formatToTelegramHtml(input);

      expect(output).toContain('📚 <b>Sources:</b>');
      expect(output).not.toContain('*');
    });

    it('should preserve math multiplication while cleaning markdown', () => {
      const input = 'Newton\'s formula is F = m * a where m is mass and a is acceleration.';
      const output = formatToTelegramHtml(input);

      expect(output).toContain('F = m * a');
    });

    it('should properly escape HTML special characters (<, >, &) in regular text', () => {
      const input = 'Compare if x < 5 && y > 10 in <div> tag.';
      const output = formatToTelegramHtml(input);

      expect(output).toContain('&lt; 5 &amp;&amp; y &gt; 10 in &lt;div&gt;');
    });

    it('should preserve code blocks and inline code without mangling formatting', () => {
      const input = `Here is sample code:
\`\`\`python
def calculate(a, b):
    # * important comment *
    return a * b
\`\`\`
Use \`var_name\` for variables.`;

      const output = formatToTelegramHtml(input);

      expect(output).toContain('<pre><code>def calculate(a, b):\n    # * important comment *\n    return a * b</code></pre>');
      expect(output).toContain('<code>var_name</code>');
    });

    it('should handle Malayalam Unicode characters properly', () => {
      const input = `**ഡാറ്റാബേസ് നോർമലൈസേഷൻ**
* ഒന്നാം നോർമൽ ഫോം (1NF)
* രണ്ടാം നോർമൽ ഫോം (2NF)`;

      const output = formatToTelegramHtml(input);

      expect(output).toContain('<b>ഡാറ്റാബേസ് നോർമലൈസേഷൻ</b>');
      expect(output).toContain('• ഒന്നാം നോർമൽ ഫോം (1NF)');
      expect(output).toContain('• രണ്ടാം നോർമൽ ഫോം (2NF)');
      expect(output).not.toContain('*');
    });

    it('should automatically balance unclosed tags', () => {
      const input = '<b>Unclosed bold text';
      const output = formatToTelegramHtml(input);

      expect(output).toBe('&lt;b&gt;Unclosed bold text');
    });
  });

  describe('stripMarkdown', () => {
    it('should strip bold/italic asterisks while preserving bullets as •', () => {
      const input = `**Title**
* **Point 1:** Description
* Point 2: F = m * a`;

      const stripped = stripMarkdown(input);

      expect(stripped).toContain('Title');
      expect(stripped).toContain('• Point 1: Description');
      expect(stripped).toContain('• Point 2: F = m * a');
      expect(stripped).not.toContain('**');
    });
  });

  describe('splitTelegramMessage', () => {
    it('should split messages exceeding max length', () => {
      const longText = 'Paragraph one\n\n' + 'A'.repeat(3000) + '\n\n' + 'B'.repeat(3000);
      const parts = splitTelegramMessage(longText, 4000);

      expect(parts.length).toBeGreaterThan(1);
      for (const part of parts) {
        expect(part.length).toBeLessThanOrEqual(4000);
      }
    });
  });
});
