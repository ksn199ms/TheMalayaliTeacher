export interface ParsedPage {
  pageNumber?: number;
  text: string;
}

export interface ParsedDocument {
  fileName: string;
  mimeType: string;
  pages: ParsedPage[];
}

export interface DocumentParser {
  supports(mimeType: string, extension: string): boolean;
  parse(filePath: string, originalFileName?: string): Promise<ParsedDocument>;
}
