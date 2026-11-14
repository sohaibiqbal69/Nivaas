import { randomUUID } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { MAX_PHOTO_BYTES } from './photo-validation.js';
import type { EvidenceObjectStore, EvidenceStorageReference, NewEvidenceStorageReference } from './evidence-storage.js';

export type S3EvidenceStorageConfiguration = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

const validStorageKey = (key: string) => /^[0-9a-f-]{36}\.bin$/.test(key);

function stopOversizedBody(body: unknown): void {
  if (!body || typeof body !== 'object') return;
  const stream = body as { destroy?: () => void; cancel?: () => Promise<void> };
  if (typeof stream.destroy === 'function') stream.destroy();
  else if (typeof stream.cancel === 'function') void stream.cancel().catch(() => undefined);
}

export class S3EvidenceStorage implements EvidenceObjectStore {
  private readonly client: S3Client;

  constructor(private readonly configuration: S3EvidenceStorageConfiguration, client?: S3Client) {
    this.client = client ?? new S3Client({
      endpoint: configuration.endpoint,
      region: configuration.region,
      forcePathStyle: true,
      credentials: { accessKeyId: configuration.accessKeyId, secretAccessKey: configuration.secretAccessKey },
    });
  }

  async write(bytes: Buffer): Promise<NewEvidenceStorageReference> {
    if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES) throw new Error('Evidence object exceeds the allowed file size.');
    const key = `${randomUUID()}.bin`;
    await this.client.send(new PutObjectCommand({
      Bucket: this.configuration.bucket,
      Key: key,
      Body: bytes,
      ContentLength: bytes.length,
      ContentType: 'application/octet-stream',
      CacheControl: 'private, no-store',
      // No ACL or public URL is set. The bucket must remain private in R2/S3.
    }));
    return { provider: 's3', storagePath: key };
  }

  async read(reference: EvidenceStorageReference): Promise<Buffer> {
    if (reference.provider && reference.provider !== 's3') throw new Error('Evidence storage provider does not match the S3 object.');
    const key = reference.storagePath;
    if (!validStorageKey(key)) throw new Error('Invalid internal evidence storage key.');
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.configuration.bucket, Key: key }));
    if (typeof result.ContentLength === 'number' && (result.ContentLength < 0 || result.ContentLength > MAX_PHOTO_BYTES)) {
      stopOversizedBody(result.Body);
      throw new Error('Evidence object exceeds the allowed file size.');
    }
    if (!result.Body) throw new Error('Evidence object has no body.');

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      size += chunk.byteLength;
      if (size > MAX_PHOTO_BYTES) {
        stopOversizedBody(result.Body);
        throw new Error('Evidence object exceeds the allowed file size.');
      }
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks, size);
  }

  async remove(reference: EvidenceStorageReference): Promise<void> {
    if (reference.provider && reference.provider !== 's3') throw new Error('Evidence storage provider does not match the S3 object.');
    const key = reference.storagePath;
    if (!validStorageKey(key)) throw new Error('Invalid internal evidence storage key.');
    await this.client.send(new DeleteObjectCommand({ Bucket: this.configuration.bucket, Key: key }));
  }
}
