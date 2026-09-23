import { Schema, model, Document, Types } from 'mongoose';

export type DocumentStatus = 'uploading' | 'processing' | 'indexing' | 'ready' | 'failed';

export interface IDocument extends Document {
  userId: Types.ObjectId;
  telegramFileId?: string;
  fileName: string;
  mimeType: string;
  fileSize?: number;
  fileHash: string;
  storagePath: string;
  storageKey?: string;
  processingJobId?: string;
  status: DocumentStatus;
  pageCount?: number;
  language?: string;
  indexVersion?: number;
  error?: string;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSchema = new Schema<IDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    telegramFileId: {
      type: String,
    },
    fileName: {
      type: String,
      required: true,
      trim: true,
    },
    mimeType: {
      type: String,
      required: true,
    },
    fileSize: {
      type: Number,
    },
    fileHash: {
      type: String,
      required: true,
      index: true,
    },
    storagePath: {
      type: String,
      required: true,
    },
    storageKey: {
      type: String,
    },
    processingJobId: {
      type: String,
      index: true,
    },
    status: {
      type: String,
      enum: ['uploading', 'processing', 'indexing', 'ready', 'failed'],
      default: 'processing',
      index: true,
    },
    pageCount: {
      type: Number,
      default: 1,
    },
    language: {
      type: String,
      default: 'en',
    },
    indexVersion: {
      type: Number,
      default: 2,
      index: true,
    },
    error: {
      type: String,
    },
    deletedAt: {
      type: Date,
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Compound indexes
DocumentSchema.index({ userId: 1, fileHash: 1 });
DocumentSchema.index({ userId: 1, deletedAt: 1, createdAt: -1 });

export const DocumentModel = model<IDocument>('Document', DocumentSchema);
