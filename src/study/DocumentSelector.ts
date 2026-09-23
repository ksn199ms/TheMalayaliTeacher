import { Markup } from 'telegraf';
import { documentService } from '../modules/documents/document.service.js';
import { IDocument } from '../database/models/Document.js';

export class DocumentSelector {
  public static readonly PAGE_SIZE = 5;

  /**
   * List all ready documents for a given user verifying isolation
   */
  public async getUserDocuments(userId: string): Promise<IDocument[]> {
    const docs = await documentService.listUserDocuments(userId);
    return docs.filter((d) => d.status === 'ready');
  }

  /**
   * Validates if a documentId exists and is owned by userId
   */
  public async validateOwnership(userId: string, documentId: string): Promise<IDocument | null> {
    return documentService.getDocumentById(userId, documentId);
  }

  /**
   * Builds a paginated inline keyboard for selecting a document for a given study mode
   */
  public buildInlineSelector(
    documents: IDocument[],
    mode: 'summarize' | 'keypoints' | 'quiz' | 'flashcards',
    page: number = 0
  ) {
    const totalPages = Math.ceil(documents.length / DocumentSelector.PAGE_SIZE) || 1;
    const clampedPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIdx = clampedPage * DocumentSelector.PAGE_SIZE;
    const pageDocs = documents.slice(startIdx, startIdx + DocumentSelector.PAGE_SIZE);

    const buttons: any[] = pageDocs.map((doc, idx) => {
      const globalIdx = startIdx + idx + 1;
      const displayName = doc.fileName.length > 28 ? `${doc.fileName.slice(0, 25)}...` : doc.fileName;
      return [
        Markup.button.callback(
          `📄 ${globalIdx}. ${displayName}`,
          `docsel:${mode}:${doc._id.toString()}`
        ),
      ];
    });

    // Navigation row if multiple pages exist
    if (totalPages > 1) {
      const navRow = [];
      if (clampedPage > 0) {
        navRow.push(Markup.button.callback('⬅️ Prev', `docpage:${mode}:${clampedPage - 1}`));
      }
      navRow.push(Markup.button.callback(`📄 ${clampedPage + 1}/${totalPages}`, 'docpage:noop'));
      if (clampedPage < totalPages - 1) {
        navRow.push(Markup.button.callback('Next ➡️', `docpage:${mode}:${clampedPage + 1}`));
      }
      buttons.push(navRow);
    }

    return Markup.inlineKeyboard(buttons);
  }

  /**
   * Builds a human-readable numbered document list message with page details
   */
  public formatDocumentList(documents: IDocument[], page: number = 0): string {
    if (documents.length === 0) {
      return '📭 You have not uploaded any study materials yet.\n\nSend a PDF, DOCX, TXT, or Markdown file to get started!';
    }

    const totalPages = Math.ceil(documents.length / DocumentSelector.PAGE_SIZE) || 1;
    const clampedPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIdx = clampedPage * DocumentSelector.PAGE_SIZE;
    const pageDocs = documents.slice(startIdx, startIdx + DocumentSelector.PAGE_SIZE);

    const lines = pageDocs.map((doc, idx) => {
      const globalIdx = startIdx + idx + 1;
      const pages = doc.pageCount ? ` (${doc.pageCount} pages)` : '';
      return `${globalIdx}. *${doc.fileName}*${pages}`;
    });

    const pageIndicator = totalPages > 1 ? ` _(Page ${clampedPage + 1} of ${totalPages})_` : '';
    return `📚 *Your Study Materials*${pageIndicator}\n\n${lines.join('\n')}\n\n_Select a document below to continue:_`;
  }
}

export const documentSelector = new DocumentSelector();
