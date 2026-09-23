import { Schema, model, Document, Types } from 'mongoose';

export interface ICitation {
  documentId: string;
  fileName: string;
  pageNumber?: number;
  chunkIndex?: number;
}

export const CitationSchema = new Schema<ICitation>(
  {
    documentId: { type: String, required: true },
    fileName: { type: String, required: true },
    pageNumber: { type: Number },
    chunkIndex: { type: Number },
  },
  { _id: false }
);

export interface IMessage extends Document {
  chatId: Types.ObjectId;
  role: 'user' | 'assistant';
  content: string;
  citations?: ICitation[];
  createdAt: Date;
}

const MessageSchema = new Schema<IMessage>(
  {
    chatId: {
      type: Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ['user', 'assistant'],
      required: true,
    },
    content: {
      type: String,
      required: true,
    },
    citations: [CitationSchema],
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  }
);

export const Message = model<IMessage>('Message', MessageSchema);
