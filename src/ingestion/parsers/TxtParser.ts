import fs from 'node:fs/promises';
import path from 'node:path';
import { DocumentParser, ParsedDocument } from './DocumentParser.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('txt.parser');

export class TxtParser implements DocumentParser {
  public supports(mimeType: string, extension: string): boolean {
    const ext = extension.toLowerCase().replace(/^\./, '');
    return ext === 'txt' || mimeType === 'text/plain';
  }

  public async parse(filePath: string, originalFileName?: string): Promise<ParsedDocument> {
    const fileName = originalFileName || path.basename(filePath);
    log.debug({ filePath, fileName }, 'Parsing TXT document...');

    try {
      const text = await fs.readFile(filePath, 'utf-8');

      if (!text.trim()) {
        throw new Error('TXT document is empty.');
      }

      return {
        fileName,
        mimeType: 'text/plain',
        pages: [
          {
            pageNumber: undefined,
            text,
          },
        ],
      };
    } catch (error: any) {
      log.error({ error: error.message, filePath }, 'Failed to parse TXT.');
      throw new Error(`Failed to parse TXT ${fileName}: ${error.message}`);
    }
  }
}
