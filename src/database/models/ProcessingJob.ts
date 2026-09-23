import { Schema, model, Document, Types } from 'mongoose';

export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

export interface IProcessingJob extends Document {
  userId: Types.ObjectId;
  documentId: Types.ObjectId;
  jobType: 'ingestion' | 'reindex' | 'summary';
  status: JobStatus;
  progress: number;
  stage: string;
  attempts: number;
  maxAttempts: number;
  error?: string;
  result?: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

const ProcessingJobSchema = new Schema<IProcessingJob>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    documentId: {
      type: Schema.Types.ObjectId,
      ref: 'Document',
      required: true,
      index: true,
    },
    jobType: {
      type: String,
      enum: ['ingestion', 'reindex', 'summary'],
      default: 'ingestion',
    },
    status: {
      type: String,
      enum: ['queued', 'processing', 'completed', 'failed'],
      default: 'queued',
      index: true,
    },
    progress: {
      type: Number,
      default: 0,
    },
    stage: {
      type: String,
      default: 'Queued',
    },
    attempts: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 3,
    },
    error: {
      type: String,
    },
    result: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

ProcessingJobSchema.index({ userId: 1, createdAt: -1 });

export const ProcessingJob = model<IProcessingJob>('ProcessingJob', ProcessingJobSchema);
