import fs from 'node:fs/promises';
import path from 'node:path';
import { DocumentParser, ParsedDocument } from './DocumentParser.js';
import { geminiOcrService } from '../../ai/GeminiOcrService.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('image.parser');

const SUPPORTED_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'bmp', 'tiff', 'tif', 'heic']);
const SUPPORTED_MIME_PREFIX = 'image/';

export class ImageParser implements DocumentParser {
  public supports(mimeType: string, extension: string): boolean {
    const ext = extension.toLowerCase().replace(/^\./, '');
    if (SUPPORTED_EXTENSIONS.has(ext)) return true;
    if (mimeType && mimeType.toLowerCase().startsWith(SUPPORTED_MIME_PREFIX)) return true;
    return false;
  }

  public async parse(filePath: string, originalFileName?: string): Promise<ParsedDocument> {
    const fileName = originalFileName || path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase().replace(/^\./, '');
    const mimeType = this.resolveMimeType(ext);

    log.info({ filePath, fileName, mimeType }, 'Parsing image via Gemini OCR...');

    try {
      const buffer = await fs.readFile(filePath);
      const pages = await geminiOcrService.extractTextFromImage(buffer, mimeType, fileName);

      return {
        fileName,
        mimeType,
        pages,
      };
    } catch (error: any) {
      log.error({ error: error.message, filePath, fileName }, 'Failed to parse image with Gemini OCR.');
      throw new Error(`Failed to extract text from image ${fileName}: ${error.message}`);
    }
  }

  private resolveMimeType(ext: string): string {
    switch (ext) {
      case 'png':
        return 'image/png';
      case 'jpg':
      case 'jpeg':
        return 'image/jpeg';
      case 'webp':
        return 'image/webp';
      case 'bmp':
        return 'image/bmp';
      case 'tiff':
      case 'tif':
        return 'image/tiff';
      case 'heic':
        return 'image/heic';
      default:
        return 'image/jpeg';
    }
  }
}
