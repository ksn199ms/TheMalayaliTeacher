import { describe, it, expect } from 'vitest';
import { LocalStorageProvider } from '../src/storage/StorageProvider.js';

describe('V5 Storage Provider Abstraction & Path Traversal Security', () => {
  const storage = new LocalStorageProvider('./data/test-storage');

  it('should upload, check existence, download, and delete files safely', async () => {
    const key = 'students/test_user/notes.txt';
    const content = Buffer.from('Study notes for database exam.');

    // Upload
    const storedKey = await storage.upload(key, content, 'text/plain');
    expect(storedKey).toBe(key);

    // Exists
    const exists = await storage.exists(key);
    expect(exists).toBe(true);

    // Download
    const downloaded = await storage.download(key);
    expect(downloaded.toString()).toBe('Study notes for database exam.');

    // Delete
    const deleted = await storage.delete(key);
    expect(deleted).toBe(true);

    const existsAfter = await storage.exists(key);
    expect(existsAfter).toBe(false);
  });

  it('should prevent path traversal attacks attempting to escape storage root', async () => {
    const dangerousKey = '../../../../etc/passwd';
    const content = Buffer.from('malicious payload');

    await expect(storage.upload(dangerousKey, content, 'text/plain')).rejects.toThrow(
      'Path traversal detected'
    );
  });
});
