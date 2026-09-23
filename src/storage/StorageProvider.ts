import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/env.js';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('storage.provider');

export interface StorageProvider {
  name: string;
  upload(key: string, buffer: Buffer, mimeType: string): Promise<string>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  getAbsolutePath?(key: string): string;
}

export class LocalStorageProvider implements StorageProvider {
  public readonly name = 'local';
  private baseDir: string;

  constructor(baseDir: string = config.UPLOAD_DIR) {
    this.baseDir = path.resolve(process.cwd(), baseDir);
  }

  private resolveSafePath(key: string): string {
    if (key.includes('..') || path.isAbsolute(key)) {
      throw new Error(`Security Violation: Path traversal detected for storage key "${key}".`);
    }
    const resolved = path.resolve(this.baseDir, key);

    if (!resolved.startsWith(this.baseDir)) {
      throw new Error(`Security Violation: Path traversal detected for storage key "${key}".`);
    }

    return resolved;
  }

  public async upload(key: string, buffer: Buffer, _mimeType: string): Promise<string> {
    const filePath = this.resolveSafePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    log.debug({ key, bytes: buffer.length }, 'Stored file to local storage.');
    return key;
  }

  public async download(key: string): Promise<Buffer> {
    const filePath = this.resolveSafePath(key);
    return await fs.readFile(filePath);
  }

  public async delete(key: string): Promise<boolean> {
    const filePath = this.resolveSafePath(key);
    try {
      await fs.unlink(filePath);
      log.debug({ key }, 'Deleted file from local storage.');
      return true;
    } catch (err: any) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  public async exists(key: string): Promise<boolean> {
    const filePath = this.resolveSafePath(key);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  public getAbsolutePath(key: string): string {
    return this.resolveSafePath(key);
  }
}

/**
 * Production Cloud S3/R2/MinIO Storage Provider stub/adapter
 */
export class S3StorageProvider implements StorageProvider {
  public readonly name = 's3';

  public async upload(key: string, _buffer: Buffer, _mimeType: string): Promise<string> {
    log.info({ key }, 'Simulated S3 Upload: Object stored to cloud bucket.');
    return key;
  }

  public async download(_key: string): Promise<Buffer> {
    throw new Error('S3 direct download requires cloud credentials.');
  }

  public async delete(key: string): Promise<boolean> {
    log.info({ key }, 'Simulated S3 Delete: Object removed from bucket.');
    return true;
  }

  public async exists(_key: string): Promise<boolean> {
    return true;
  }
}

export class StorageFactory {
  private static instance?: StorageProvider;

  public static getProvider(): StorageProvider {
    if (!this.instance) {
      if (config.STORAGE_PROVIDER === 's3') {
        this.instance = new S3StorageProvider();
      } else {
        this.instance = new LocalStorageProvider();
      }
    }
    return this.instance;
  }

  public static setProvider(provider: StorageProvider): void {
    this.instance = provider;
  }
}

export const storage = StorageFactory.getProvider();
