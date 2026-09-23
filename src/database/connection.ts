import mongoose from 'mongoose';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('database');

export async function connectDatabase(uri: string = config.MONGODB_URI): Promise<typeof mongoose> {
  try {
    log.info({ uri: uri.replace(/\/\/.*@/, '//***@') }, 'Connecting to MongoDB...');

    mongoose.connection.on('connected', () => {
      log.info('MongoDB connection established successfully.');
    });

    mongoose.connection.on('error', (err) => {
      log.error({ error: err.message }, 'MongoDB connection error.');
    });

    mongoose.connection.on('disconnected', () => {
      log.warn('MongoDB disconnected.');
    });

    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });

    return mongoose;
  } catch (error: any) {
    log.error({ error: error.message }, 'Failed to connect to MongoDB.');
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      log.info('MongoDB disconnected cleanly.');
    }
  } catch (error: any) {
    log.error({ error: error.message }, 'Error disconnecting MongoDB.');
  }
}
