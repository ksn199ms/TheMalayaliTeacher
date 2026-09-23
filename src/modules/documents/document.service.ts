import fs from 'node:fs/promises';
import path from 'node:path';
import { Types } from 'mongoose';
import { DocumentModel, IDocument } from '../../database/models/Document.js';
import { Chat } from '../../database/models/Chat.js';
import { qdrantService } from '../../vector/qdrant.service.js';
import { createChildLogger } from '../../utils/logger.js';

const log = createChildLogger('document.service');

export class DocumentService {
  /**
   * List all documents for a given user
   */
  public async listUserDocuments(userId: string): Promise<IDocument[]> {
    return DocumentModel.find({ userId: new Types.ObjectId(userId) }).sort({ createdAt: -1 });
  }

  /**
   * Get single document by ID verifying ownership
   */
  public async getDocumentById(userId: string, documentId: string): Promise<IDocument | null> {
    return DocumentModel.findOne({
      _id: new Types.ObjectId(documentId),
      userId: new Types.ObjectId(userId),
    });
  }

  /**
   * Delete document: removes vectors from Qdrant, deletes local file, removes from chats, and deletes Mongo doc
   */
  public async deleteDocument(userId: string, documentId: string): Promise<boolean> {
    log.info({ userId, documentId }, 'Deleting document and associated vectors...');

    const doc = await this.getDocumentById(userId, documentId);
    if (!doc) {
      log.warn({ userId, documentId }, 'Document not found or ownership mismatch.');
      return false;
    }

    // 1. Remove vectors from Qdrant
    try {
      await qdrantService.deleteDocumentVectors(userId, documentId);
    } catch (err: any) {
      log.error({ error: err.message, userId, documentId }, 'Error deleting vectors from Qdrant.');
    }

    // 2. Remove local file / folder
    if (doc.storagePath) {
      try {
        const fileDir = path.dirname(doc.storagePath);
        await fs.rm(fileDir, { recursive: true, force: true });
        log.debug({ path: fileDir }, 'Local document file deleted.');
      } catch (err: any) {
        log.warn({ error: err.message, path: doc.storagePath }, 'Failed to delete local document file.');
      }
    }

    // 3. Remove document reference from chats
    try {
      await Chat.updateMany(
        { userId: new Types.ObjectId(userId) },
        { $pull: { documentIds: new Types.ObjectId(documentId) } }
      );
    } catch (err: any) {
      log.error({ error: err.message }, 'Failed to remove document reference from chats.');
    }

    // 4. Delete MongoDB Document
    await DocumentModel.deleteOne({ _id: doc._id });
    log.info({ userId, documentId }, 'Document successfully deleted.');
    return true;
  }

  /**
   * Delete all documents, files, and vectors for a specific user
   */
  public async clearAllUserDocuments(userId: string): Promise<number> {
    const docs = await this.listUserDocuments(userId);
    log.info({ userId, count: docs.length }, 'Clearing all documents for user...');
    for (const doc of docs) {
      await this.deleteDocument(userId, doc._id.toString());
    }
    return docs.length;
  }
}

export const documentService = new DocumentService();
