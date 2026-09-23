/**
 * Text cleaner module
 * Cleans extracted text without stripping Unicode or non-ASCII characters (including Malayalam).
 */

export function cleanText(text: string): string {
  if (!text) return '';

  let cleaned = text;

  // 1. Remove control characters (except newline \n, carriage return \r, tab \t)
  // \x00-\x08, \x0B-\x0C, \x0E-\x1F, \x7F
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  // 2. Normalize Windows (\r\n) and classic Mac (\r) newlines to standard Unix (\n)
  cleaned = cleaned.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 3. Preserve code blocks and tables while cleaning text
  const lines = cleaned.split('\n');
  let inCodeBlock = false;
  const processedLines: string[] = [];

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (trimmed.startsWith('```')) {
      inCodeBlock = !inCodeBlock;
      processedLines.push(trimmed);
      continue;
    }

    if (inCodeBlock) {
      // Inside code block: preserve indentation and syntax exactly
      processedLines.push(rawLine.replace(/[\t]/g, '    ').trimEnd());
    } else if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      // Inside Markdown table: normalize spacing inside cells while preserving table structure
      processedLines.push(trimmed);
    } else {
      // Standard prose line: trim ends, collapse multiple inline spaces
      processedLines.push(rawLine.replace(/[ \t]+/g, ' ').trim());
    }
  }

  cleaned = processedLines.join('\n');

  // 4. Collapse 3 or more consecutive newlines down to 2 (preserving paragraph breaks)
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  return cleaned.trim();
}
