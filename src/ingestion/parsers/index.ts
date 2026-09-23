import path from 'node:path';
import { DocumentParser } from './DocumentParser.js';
import { PdfParser } from './PdfParser.js';
import { DocxParser } from './DocxParser.js';
import { TxtParser } from './TxtParser.js';
import { MarkdownParser } from './MarkdownParser.js';
import { ImageParser } from './ImageParser.js';

export * from './DocumentParser.js';
export * from './PdfParser.js';
export * from './DocxParser.js';
export * from './TxtParser.js';
export * from './MarkdownParser.js';
export * from './ImageParser.js';

export class ParserRegistry {
  private parsers: DocumentParser[] = [];

  constructor() {
    this.parsers = [
      new PdfParser(),
      new DocxParser(),
      new TxtParser(),
      new MarkdownParser(),
      new ImageParser(),
    ];
  }

  public register(parser: DocumentParser): void {
    this.parsers.push(parser);
  }

  public getParser(fileName: string, mimeType: string): DocumentParser | undefined {
    const ext = path.extname(fileName).toLowerCase();
    return this.parsers.find((p) => p.supports(mimeType, ext));
  }

  public isSupported(fileName: string, mimeType: string): boolean {
    return !!this.getParser(fileName, mimeType);
  }
}

export const parserRegistry = new ParserRegistry();
