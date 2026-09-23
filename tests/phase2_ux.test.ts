import { describe, it, expect } from 'vitest';
import { documentSelector } from '../src/study/DocumentSelector.js';
import { buildMainMenuKeyboard, MAIN_MENU_BUTTONS } from '../src/bot/keyboards/keyboard.js';
import { IDocument } from '../src/database/models/Document.js';

describe('Phase 2: UX & Conversational Navigation Tests', () => {
  describe('Main Navigation Keyboard', () => {
    it('should build the persistent reply keyboard with all key actions', () => {
      const keyboard = buildMainMenuKeyboard();
      expect(keyboard).toBeDefined();
      expect(keyboard.reply_markup).toBeDefined();
      expect(keyboard.reply_markup.keyboard.length).toBe(4);

      // Check first row
      expect(keyboard.reply_markup.keyboard[0]).toContain(MAIN_MENU_BUTTONS.STUDY);
      expect(keyboard.reply_markup.keyboard[0]).toContain(MAIN_MENU_BUTTONS.DOCS);

      // Check second row
      expect(keyboard.reply_markup.keyboard[1]).toContain(MAIN_MENU_BUTTONS.QUIZ);
      expect(keyboard.reply_markup.keyboard[1]).toContain(MAIN_MENU_BUTTONS.FLASHCARDS);

      // Check third row
      expect(keyboard.reply_markup.keyboard[2]).toContain(MAIN_MENU_BUTTONS.SUMMARY);
      expect(keyboard.reply_markup.keyboard[2]).toContain(MAIN_MENU_BUTTONS.SIMPLIFY);

      // Check fourth row
      expect(keyboard.reply_markup.keyboard[3]).toContain(MAIN_MENU_BUTTONS.PROFILE);
      expect(keyboard.reply_markup.keyboard[3]).toContain(MAIN_MENU_BUTTONS.HELP);
    });
  });

  describe('DocumentSelector Pagination', () => {
    const mockDocuments: Partial<IDocument>[] = Array.from({ length: 12 }, (_, i) => ({
      _id: { toString: () => `mock_doc_id_${i + 1}` } as any,
      fileName: `Study_Notes_Chapter_${i + 1}.pdf`,
      pageCount: (i + 1) * 3,
      status: 'ready',
    }));

    it('should paginate 12 documents into 3 pages with 5 per page on page 0', () => {
      const keyboard = documentSelector.buildInlineSelector(mockDocuments as IDocument[], 'quiz', 0);
      expect(keyboard.reply_markup.inline_keyboard.length).toBe(6); // 5 docs + 1 nav row

      // Check first doc button
      expect(keyboard.reply_markup.inline_keyboard[0][0].text).toContain('1. Study_Notes_Chapter_1.pdf');
      expect(keyboard.reply_markup.inline_keyboard[0][0].callback_data).toBe('docsel:quiz:mock_doc_id_1');

      // Check navigation row on page 0
      const navRow = keyboard.reply_markup.inline_keyboard[5];
      expect(navRow.length).toBe(2); // Indicator + Next
      expect(navRow[0].text).toBe('📄 1/3');
      expect(navRow[1].text).toBe('Next ➡️');
      expect(navRow[1].callback_data).toBe('docpage:quiz:1');
    });

    it('should render both Prev and Next buttons on middle page (page 1)', () => {
      const keyboard = documentSelector.buildInlineSelector(mockDocuments as IDocument[], 'flashcards', 1);
      expect(keyboard.reply_markup.inline_keyboard.length).toBe(6);

      // Check navigation row on page 1
      const navRow = keyboard.reply_markup.inline_keyboard[5];
      expect(navRow.length).toBe(3); // Prev + Indicator + Next
      expect(navRow[0].text).toBe('⬅️ Prev');
      expect(navRow[0].callback_data).toBe('docpage:flashcards:0');
      expect(navRow[1].text).toBe('📄 2/3');
      expect(navRow[2].text).toBe('Next ➡️');
      expect(navRow[2].callback_data).toBe('docpage:flashcards:2');
    });

    it('should render only Prev button on last page (page 2)', () => {
      const keyboard = documentSelector.buildInlineSelector(mockDocuments as IDocument[], 'summarize', 2);
      expect(keyboard.reply_markup.inline_keyboard.length).toBe(3); // 2 remaining docs + 1 nav row

      const navRow = keyboard.reply_markup.inline_keyboard[2];
      expect(navRow.length).toBe(2); // Prev + Indicator
      expect(navRow[0].text).toBe('⬅️ Prev');
      expect(navRow[0].callback_data).toBe('docpage:summarize:1');
      expect(navRow[1].text).toBe('📄 3/3');
    });

    it('should format document list with page indicator', () => {
      const text = documentSelector.formatDocumentList(mockDocuments as IDocument[], 0);
      expect(text).toContain('Page 1 of 3');
      expect(text).toContain('1. *Study_Notes_Chapter_1.pdf* (3 pages)');
      expect(text).toContain('5. *Study_Notes_Chapter_5.pdf* (15 pages)');
      expect(text).not.toContain('6. *Study_Notes_Chapter_6.pdf*');
    });
  });
});
