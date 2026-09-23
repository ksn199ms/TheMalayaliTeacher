import { Schema, model, Document, Types } from 'mongoose';

export interface IChat extends Document {
  userId: Types.ObjectId;
  documentIds: Types.ObjectId[];
  title?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChatSchema = new Schema<IChat>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    documentIds: [
      {
        type: Schema.Types.ObjectId,
        ref: 'Document',
      },
    ],
    title: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const Chat = model<IChat>('Chat', ChatSchema);
