import { mkdir, writeFile, readFile, unlink, lstat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { EvidenceObjectStore, EvidenceStorageReference, NewEvidenceStorageReference } from './evidence-storage.js';

export class LocalEvidenceStorage implements EvidenceObjectStore {
  constructor(private readonly directory = resolve(__dirname, '../../../uploads/complaint-evidence')) {}
  private path(key: string) {
    if (!/^[0-9a-f-]{36}\.bin$/.test(key)) throw new Error('Invalid internal evidence storage key.');
    return resolve(this.directory, key);
  }
  async write(bytes: Buffer): Promise<NewEvidenceStorageReference> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const key = `${randomUUID()}.bin`;
    try { await writeFile(this.path(key), bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST')) await this.remove({ provider: 'local', storagePath: key }).catch(() => undefined);
      throw error;
    }
    return { provider: 'local', storagePath: key };
  }
  async read(reference: EvidenceStorageReference): Promise<Buffer> {
    if (reference.provider && reference.provider !== 'local') throw new Error('Evidence storage provider does not match the local object.');
    const key = reference.storagePath;
    const file = this.path(key);
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5 * 1024 * 1024) throw new Error('Evidence storage is not a valid bounded file.');
    return readFile(file);
  }
  async remove(reference: EvidenceStorageReference): Promise<void> {
    if (reference.provider && reference.provider !== 'local') throw new Error('Evidence storage provider does not match the local object.');
    await unlink(this.path(reference.storagePath));
  }
}
