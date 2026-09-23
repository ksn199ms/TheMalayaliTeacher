import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFParse } from 'pdf-parse';
import { DocumentParser, ParsedDocument, ParsedPage } from './DocumentParser.js';
import { geminiOcrService } from '../../ai/GeminiOcrService.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('pdf.parser');

export class PdfParser implements DocumentParser {
  public supports(mimeType: string, extension: string): boolean {
    const ext = extension.toLowerCase().replace(/^\./, '');
    return ext === 'pdf' || mimeType === 'application/pdf';
  }

  public async parse(filePath: string, originalFileName?: string): Promise<ParsedDocument> {
    const fileName = originalFileName || path.basename(filePath);
    log.debug({ filePath, fileName }, 'Parsing PDF document...');

    let parser: any;
    let buffer: Buffer | undefined;

    try {
      buffer = await fs.readFile(filePath);
      parser = new PDFParse({ data: buffer });
      const result = await parser.getText();

      const pages: ParsedPage[] = [];

      if (result.pages && Array.isArray(result.pages) && result.pages.length > 0) {
        for (const p of result.pages) {
          pages.push({
            pageNumber: p.num,
            text: p.text || '',
          });
        }
      } else if (result.text) {
        pages.push({
          pageNumber: 1,
          text: result.text,
        });
      }

      // Check if pages are empty or contain minimal text (e.g. scanned images in PDF)
      const totalLength = pages.reduce((acc, p) => acc + p.text.trim().length, 0);
      if (totalLength < 30) {
        log.info({ fileName, totalLength }, 'PDF contains little or no extractable text. Falling back to Gemini Multimodal OCR...');
        const ocrPages = await geminiOcrService.extractTextFromPdf(buffer, fileName);
        return {
          fileName,
          mimeType: 'application/pdf',
          pages: ocrPages,
        };
      }

      return {
        fileName,
        mimeType: 'application/pdf',
        pages,
      };
    } catch (error: any) {
      log.warn({ error: error.message, filePath }, 'Standard PDF parsing failed, attempting Gemini Multimodal OCR fallback...');
      try {
        if (!buffer) {
          buffer = await fs.readFile(filePath);
        }
        const ocrPages = await geminiOcrService.extractTextFromPdf(buffer, fileName);
        return {
          fileName,
          mimeType: 'application/pdf',
          pages: ocrPages,
        };
      } catch (ocrError: any) {
        log.error({ error: ocrError.message, filePath }, 'Failed to parse PDF with both pdf-parse and Gemini OCR.');
        throw new Error(`Failed to parse PDF ${fileName}: ${ocrError.message}`);
      }
    } finally {
      if (parser && typeof parser.destroy === 'function') {
        try {
          await parser.destroy();
        } catch {
          // ignore cleanup error
        }
      }
    }
  }
}
