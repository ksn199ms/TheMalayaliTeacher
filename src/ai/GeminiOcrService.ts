import { GoogleGenAI } from '@google/genai';
import { geminiRequestManager } from './GeminiRequestManager.js';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';
import { ParsedPage } from '../ingestion/parsers/DocumentParser.js';

const log = createChildLogger('gemini.ocr.service');

export interface OcrPageResult {
  pageNumber: number;
  text: string;
}

export class GeminiOcrService {
  private ai: GoogleGenAI;
  private model: string;

  constructor(apiKey: string = config.GEMINI_API_KEY, model: string = config.GEMINI_MODEL) {
    this.ai = new GoogleGenAI({ apiKey: apiKey || 'unconfigured' });
    if (!model || model === 'gemini-2.5-flash' || model === 'gemini-3.6-flash' || model === 'gemini-3.8-flash') {
      this.model = config.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    } else {
      this.model = model;
    }
  }

  private cleanJsonResponse(rawText: string): string {
    let text = rawText.trim();
    if (text.startsWith('```json')) {
      text = text.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return text.trim();
  }

  /**
   * Extract text from a scanned or image-based PDF document using Gemini Multimodal OCR
   */
  public async extractTextFromPdf(
    pdfBuffer: Buffer,
    fileName: string = 'scanned-doc.pdf',
    userId: string = 'system'
  ): Promise<ParsedPage[]> {
    log.info({ fileName, bufferSize: pdfBuffer.length }, 'Performing Gemini Multimodal OCR on PDF...');

    const context = geminiRequestManager.createRequestContext(userId, 'ocr', 5, 'HIGH');
    const base64Data = pdfBuffer.toString('base64');

    const prompt = `You are an expert document OCR and data extraction system.
Extract all visible text, headings, tabular data, formulas, diagrams descriptions, and handwritten notes from this document accurately.
Preserve the document's logical reading order, headings, and structure using clean Markdown.
If the document spans multiple pages, transcribe each page separately.

Output a strictly valid JSON object with the following schema:
{
  "pages": [
    {
      "pageNumber": 1,
      "text": "Full extracted markdown text for page 1"
    }
  ]
}`;

    const rawResponse = await geminiRequestManager.execute(context, async () => {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: 'application/pdf',
            },
          },
          {
            text: prompt,
          },
        ],
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      return response.text || '';
    });

    const parsedPages = this.parsePagesFromJson(rawResponse, fileName);
    log.info({ fileName, pageCount: parsedPages.length }, 'PDF OCR extraction completed successfully.');
    return parsedPages;
  }

  /**
   * Extract text and data from an image file (PNG, JPEG, WEBP, BMP, etc.)
   */
  public async extractTextFromImage(
    imageBuffer: Buffer,
    mimeType: string,
    fileName: string = 'image.png',
    userId: string = 'system'
  ): Promise<ParsedPage[]> {
    log.info({ fileName, mimeType, bufferSize: imageBuffer.length }, 'Performing Gemini Multimodal OCR on image...');

    const context = geminiRequestManager.createRequestContext(userId, 'ocr', 5, 'HIGH');
    const base64Data = imageBuffer.toString('base64');

    const prompt = `You are an expert OCR and document understanding specialist.
Extract all readable text, formulas, equations, tables, lists, and handwritten notes from this image.
Format the output cleanly using standard Markdown with appropriate headings and bullet points.
If there is visual data like charts or diagrams, provide a concise descriptive summary alongside the text.

Output a strictly valid JSON object with the following schema:
{
  "pages": [
    {
      "pageNumber": 1,
      "text": "Full extracted markdown text"
    }
  ]
}`;

    const rawResponse = await geminiRequestManager.execute(context, async () => {
      const response = await this.ai.models.generateContent({
        model: this.model,
        contents: [
          {
            inlineData: {
              data: base64Data,
              mimeType: mimeType || 'image/jpeg',
            },
          },
          {
            text: prompt,
          },
        ],
        config: {
          temperature: 0.1,
          responseMimeType: 'application/json',
        },
      });

      return response.text || '';
    });

    const parsedPages = this.parsePagesFromJson(rawResponse, fileName);
    log.info({ fileName, pageCount: parsedPages.length }, 'Image OCR extraction completed successfully.');
    return parsedPages;
  }

  private parsePagesFromJson(rawResponse: string, fileName: string): ParsedPage[] {
    const cleaned = this.cleanJsonResponse(rawResponse);

    try {
      const json = JSON.parse(cleaned);
      if (Array.isArray(json.pages) && json.pages.length > 0) {
        return json.pages
          .filter((p: any) => p && typeof p.text === 'string' && p.text.trim().length > 0)
          .map((p: any, idx: number) => ({
            pageNumber: typeof p.pageNumber === 'number' ? p.pageNumber : idx + 1,
            text: p.text.trim(),
          }));
      }
    } catch (parseErr) {
      log.warn({ fileName, error: (parseErr as Error).message }, 'Failed to parse OCR response as JSON. Using fallback text extraction.');
    }

    // Fallback: If JSON parsing fails or schema was not adhered to, return the text directly
    const fallbackText = cleaned.replace(/^\{.*"text":\s*"/s, '').replace(/"\s*\}\s*$/s, '').trim();
    if (fallbackText.length > 0) {
      return [
        {
          pageNumber: 1,
          text: fallbackText,
        },
      ];
    }

    throw new Error(`OCR was unable to extract any readable text from ${fileName}. The image or document may be blank or unreadable.`);
  }
}

export const geminiOcrService = new GeminiOcrService();
