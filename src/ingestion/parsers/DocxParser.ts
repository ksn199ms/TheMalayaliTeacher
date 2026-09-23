import path from 'node:path';
import mammoth from 'mammoth';
import { DocumentParser, ParsedDocument } from './DocumentParser.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('docx.parser');

export class DocxParser implements DocumentParser {
  public supports(mimeType: string, extension: string): boolean {
    const ext = extension.toLowerCase().replace(/^\./, '');
    return (
      ext === 'docx' ||
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    );
  }

  public async parse(filePath: string, originalFileName?: string): Promise<ParsedDocument> {
    const fileName = originalFileName || path.basename(filePath);
    log.debug({ filePath, fileName }, 'Parsing DOCX document...');

    try {
      const result = await mammoth.extractRawText({ path: filePath });
      const text = result.value || '';

      if (!text.trim()) {
        throw new Error('DOCX document contains no extractable text.');
      }

      return {
        fileName,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        pages: [
          {
            pageNumber: undefined, // Do not invent page numbers for DOCX
            text,
          },
        ],
      };
    } catch (error: any) {
      log.error({ error: error.message, filePath }, 'Failed to parse DOCX.');
      throw new Error(`Failed to parse DOCX ${fileName}: ${error.message}`);
    }
  }
}
