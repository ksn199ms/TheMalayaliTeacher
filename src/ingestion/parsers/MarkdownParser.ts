import fs from 'node:fs/promises';
import path from 'node:path';
import { DocumentParser, ParsedDocument } from './DocumentParser.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('markdown.parser');

export class MarkdownParser implements DocumentParser {
  public supports(mimeType: string, extension: string): boolean {
    const ext = extension.toLowerCase().replace(/^\./, '');
    return ext === 'md' || ext === 'markdown' || mimeType === 'text/markdown';
  }

  public async parse(filePath: string, originalFileName?: string): Promise<ParsedDocument> {
    const fileName = originalFileName || path.basename(filePath);
    log.debug({ filePath, fileName }, 'Parsing Markdown document...');

    try {
      const text = await fs.readFile(filePath, 'utf-8');

      if (!text.trim()) {
        throw new Error('Markdown document is empty.');
      }

      return {
        fileName,
        mimeType: 'text/markdown',
        pages: [
          {
            pageNumber: undefined,
            text,
          },
        ],
      };
    } catch (error: any) {
      log.error({ error: error.message, filePath }, 'Failed to parse Markdown.');
      throw new Error(`Failed to parse Markdown ${fileName}: ${error.message}`);
    }
  }
}
