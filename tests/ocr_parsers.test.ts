import { describe, it, expect, vi } from 'vitest';
import { parserRegistry } from '../src/ingestion/parsers/index.js';
import { ImageParser } from '../src/ingestion/parsers/ImageParser.js';
import { PdfParser } from '../src/ingestion/parsers/PdfParser.js';
import { geminiOcrService } from '../src/ai/GeminiOcrService.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

describe('OCR and Scanned Document Parsers', () => {
  it('should support image formats in parserRegistry', () => {
    expect(parserRegistry.isSupported('notes.png', 'image/png')).toBe(true);
    expect(parserRegistry.isSupported('page.jpg', 'image/jpeg')).toBe(true);
    expect(parserRegistry.isSupported('scan.jpeg', 'image/jpeg')).toBe(true);
    expect(parserRegistry.isSupported('document.webp', 'image/webp')).toBe(true);
    expect(parserRegistry.isSupported('diagram.bmp', 'image/bmp')).toBe(true);
    expect(parserRegistry.isSupported('handout.pdf', 'application/pdf')).toBe(true);
  });

  it('should resolve ImageParser for image files', () => {
    const parser = parserRegistry.getParser('exam_sheet.jpg', 'image/jpeg');
    expect(parser).toBeInstanceOf(ImageParser);
  });

  it('should resolve PdfParser for PDF files', () => {
    const parser = parserRegistry.getParser('scanned_book.pdf', 'application/pdf');
    expect(parser).toBeInstanceOf(PdfParser);
  });

  it('ImageParser should call geminiOcrService and return ParsedDocument', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-test-'));
    const tmpFile = path.join(tmpDir, 'test_image.png');
    await fs.writeFile(tmpFile, Buffer.from('fake-png-data'));

    const ocrSpy = vi.spyOn(geminiOcrService, 'extractTextFromImage').mockResolvedValueOnce([
      {
        pageNumber: 1,
        text: '# Extracted Lecture Notes\n\n- Point 1: Machine Learning Basics\n- Point 2: Neural Networks',
      },
    ]);

    const parser = new ImageParser();
    const result = await parser.parse(tmpFile, 'test_image.png');

    expect(ocrSpy).toHaveBeenCalledTimes(1);
    expect(result.fileName).toBe('test_image.png');
    expect(result.mimeType).toBe('image/png');
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].text).toContain('Machine Learning Basics');

    ocrSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('PdfParser should trigger Gemini OCR fallback when PDF has no extractable text', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ocr-pdf-test-'));
    const tmpFile = path.join(tmpDir, 'scanned_empty.pdf');

    // Minimal PDF without any text streams
    const minimalScannedPdf = `%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj
3 0 obj<</Type/Page/MediaBox[0 0 300 144]/Parent 2 0 R/Resources<<>>>>endobj
xref
0 4
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
trailer<</Size 4/Root 1 0 R>>
startxref
198
%%EOF`;

    await fs.writeFile(tmpFile, Buffer.from(minimalScannedPdf));

    const ocrSpy = vi.spyOn(geminiOcrService, 'extractTextFromPdf').mockResolvedValueOnce([
      {
        pageNumber: 1,
        text: '## Scanned Document Content\nFormula: E = mc^2',
      },
    ]);

    const parser = new PdfParser();
    const result = await parser.parse(tmpFile, 'scanned_empty.pdf');

    expect(ocrSpy).toHaveBeenCalledTimes(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].text).toContain('E = mc^2');

    ocrSpy.mockRestore();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });
});
