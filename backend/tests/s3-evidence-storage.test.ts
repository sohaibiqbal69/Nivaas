import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { S3EvidenceStorage } from '../src/modules/evidence/s3-evidence-storage.js';

const configuration = {
  endpoint: 'https://account-id.r2.cloudflarestorage.com',
  bucket: 'nivaas-private-evidence-demo',
  region: 'auto',
  accessKeyId: 'test-access-key-id',
  secretAccessKey: 'test-secret-access-key-not-real',
};

function createStorage(send: ReturnType<typeof vi.fn>) {
  return new S3EvidenceStorage(configuration, { send } as unknown as S3Client);
}

describe('private S3-compatible evidence storage', () => {
  it('writes opaque private objects without ACLs or public URLs', async () => {
    const send = vi.fn().mockResolvedValue({});
    const storage = createStorage(send);
    const bytes = Buffer.from('validated image bytes');
    const reference = await storage.write(bytes);
    const key = reference.storagePath;
    const command = send.mock.calls[0][0] as PutObjectCommand;
    expect(command).toBeInstanceOf(PutObjectCommand);
    expect(command.input.Bucket).toBe(configuration.bucket);
    expect(command.input.Key).toMatch(/^[0-9a-f-]{36}\.bin$/);
    expect(command.input.Body).toBe(bytes);
    expect(command.input.ContentType).toBe('application/octet-stream');
    expect(command.input.ACL).toBeUndefined();
    expect(command.input.CacheControl).toContain('private');
    expect(key).toBe(command.input.Key);
  });

  it('reads bounded object data and removes the exact private key', async () => {
    const key = 'c7c1d55e-71e8-4476-b56e-3246f9ae4d18.bin';
    const expected = Buffer.from('private evidence');
    const send = vi.fn()
      .mockResolvedValueOnce({ ContentLength: expected.length, Body: Readable.from([expected]) })
      .mockResolvedValueOnce({});
    const storage = createStorage(send);
    await expect(storage.read({ provider: 's3', storagePath: key })).resolves.toEqual(expected);
    expect(send.mock.calls[0][0]).toBeInstanceOf(GetObjectCommand);
    await storage.remove({ provider: 's3', storagePath: key });
    const removeCommand = send.mock.calls[1][0] as DeleteObjectCommand;
    expect(removeCommand).toBeInstanceOf(DeleteObjectCommand);
    expect(removeCommand.input).toMatchObject({ Bucket: configuration.bucket, Key: key });
  });

  it('rejects malformed keys and oversized uploads before storage access', async () => {
    const send = vi.fn();
    const storage = createStorage(send);
    await expect(storage.read({ provider: 's3', storagePath: '../evidence' })).rejects.toThrow(/storage key/);
    await expect(storage.remove({ provider: 's3', storagePath: '../evidence' })).rejects.toThrow(/storage key/);
    await expect(storage.write(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toThrow(/file size/);
    expect(send).not.toHaveBeenCalled();
  });

  it('rejects objects whose reported or streamed size exceeds the evidence limit', async () => {
    const key = 'c7c1d55e-71e8-4476-b56e-3246f9ae4d18.bin';
    const tooLarge = Buffer.alloc(5 * 1024 * 1024 + 1);
    const sendReportedLarge = vi.fn().mockResolvedValue({ ContentLength: tooLarge.length, Body: Readable.from([]) });
    await expect(createStorage(sendReportedLarge).read({ provider: 's3', storagePath: key })).rejects.toThrow(/file size/);

    const sendStreamedLarge = vi.fn().mockResolvedValue({ Body: Readable.from([tooLarge]) });
    await expect(createStorage(sendStreamedLarge).read({ provider: 's3', storagePath: key })).rejects.toThrow(/file size/);
  });
});
