import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { PutObjectResult, StorageProvider } from './storage.types';
import { localDataDir } from '../localData';

const UPLOAD_ROOT = path.join(localDataDir(), 'uploads');

function resolveSafePath(key: string): string {
  const resolved = path.resolve(UPLOAD_ROOT, key);
  if (!resolved.startsWith(UPLOAD_ROOT)) {
    throw new Error('Invalid storage key: path traversal detected');
  }
  return resolved;
}

/**
 * Dev-only fallback storage. NOT for production use — no encryption at rest,
 * "signed URL" is just a locally-verifiable token, not a real short-lived
 * pre-signed URL served by an external object store.
 */
export class LocalDiskStorage implements StorageProvider {
  async put(key: string, buffer: Buffer, _contentType: string): Promise<PutObjectResult> {
    const filePath = resolveSafePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
    return { storageKey: key };
  }

  async getSignedUrl(key: string, expirySeconds = 300): Promise<string> {
    const filePath = resolveSafePath(key);
    await fs.access(filePath);
    const expiresAt = Date.now() + expirySeconds * 1000;
    const token = crypto.createHash('sha256').update(`${key}:${expiresAt}`).digest('hex');
    return `local://${key}?expires=${expiresAt}&token=${token}`;
  }

  async delete(key: string): Promise<void> {
    const filePath = resolveSafePath(key);
    await fs.rm(filePath, { force: true });
  }
}
