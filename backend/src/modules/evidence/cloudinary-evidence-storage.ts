import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import type { EvidenceObjectStore, EvidenceStorageReference, NewEvidenceStorageReference } from './evidence-storage.js';
import { MAX_PHOTO_BYTES, validatePhoto } from './photo-validation.js';

export type CloudinaryEvidenceStorageConfiguration = {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
};

type CloudinaryUpload = UploadApiResponse & { asset_id?: string };
type CloudinarySdk = typeof cloudinary;
type FetchFunction = typeof fetch;

const publicIdPattern = /^nivaas-evidence\/[0-9a-f-]{36}$/;
const assetIdPattern = /^[a-zA-Z0-9_-]{16,128}$/;

function assertCloudinaryReference(reference: EvidenceStorageReference): asserts reference is EvidenceStorageReference & {
  provider: 'cloudinary'; assetId: string; resourceType: 'image'; deliveryType: 'authenticated'; format: 'jpg' | 'png'; version: number;
} {
  if (reference.provider !== 'cloudinary'
    || !publicIdPattern.test(reference.storagePath)
    || !reference.assetId || !assetIdPattern.test(reference.assetId)
    || reference.resourceType !== 'image'
    || reference.deliveryType !== 'authenticated'
    || !['jpg', 'png'].includes(reference.format ?? '')
    || !Number.isSafeInteger(reference.version) || (reference.version ?? 0) < 1) {
    throw new Error('Invalid internal Cloudinary evidence reference.');
  }
}

async function readBounded(response: Response): Promise<Buffer> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_PHOTO_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error('Evidence object exceeds the allowed file size.');
  }
  if (!response.body) throw new Error('Evidence object has no body.');
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_PHOTO_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error('Evidence object exceeds the allowed file size.');
      }
      chunks.push(Buffer.from(value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

export class CloudinaryEvidenceStorage implements EvidenceObjectStore {
  constructor(
    configuration: CloudinaryEvidenceStorageConfiguration,
    private readonly sdk: CloudinarySdk = cloudinary,
    private readonly fetcher: FetchFunction = fetch,
  ) {
    this.sdk.config({ cloud_name: configuration.cloudName, api_key: configuration.apiKey, api_secret: configuration.apiSecret, secure: true });
  }

  async write(bytes: Buffer): Promise<NewEvidenceStorageReference> {
    const image = validatePhoto(bytes);
    if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new Error('Evidence object exceeds the allowed file size.');
    const publicId = `nivaas-evidence/${randomUUID()}`;
    const upload = await new Promise<CloudinaryUpload>((resolve, reject) => {
      const stream = this.sdk.uploader.upload_stream({
        resource_type: 'image',
        type: 'authenticated',
        public_id: publicId,
        allowed_formats: ['jpg', 'png'],
        overwrite: false,
        unique_filename: false,
        use_filename: false,
        discard_original_filename: true,
      }, (error, result) => {
        if (error) reject(error);
        else if (result) resolve(result as CloudinaryUpload);
        else reject(new Error('Cloudinary returned no upload result.'));
      });
      stream.once('error', reject);
      Readable.from([bytes]).pipe(stream);
    });

    if (upload.public_id !== publicId || upload.resource_type !== 'image' || upload.type !== 'authenticated'
      || !upload.asset_id || !assetIdPattern.test(upload.asset_id)
      || upload.bytes !== bytes.length || upload.format !== image.extension
      || !Number.isSafeInteger(upload.version) || upload.version < 1) {
      // An unexpected successful remote upload must not become an untracked public asset.
      if (upload.public_id && upload.resource_type === 'image' && upload.type === 'authenticated') {
        await this.sdk.uploader.destroy(upload.public_id, { resource_type: 'image', type: 'authenticated' }).catch(() => undefined);
      }
      throw new Error('Cloudinary returned unexpected evidence metadata.');
    }
    return {
      provider: 'cloudinary',
      storagePath: upload.public_id,
      assetId: upload.asset_id,
      resourceType: 'image',
      deliveryType: 'authenticated',
      format: upload.format as 'jpg' | 'png',
      version: upload.version,
    };
  }

  async read(reference: EvidenceStorageReference): Promise<Buffer> {
    assertCloudinaryReference(reference);
    const url = this.sdk.utils.private_download_url(reference.storagePath, reference.format, {
      resource_type: reference.resourceType,
      type: reference.deliveryType,
      expires_at: Math.floor(Date.now() / 1000) + 60,
    });
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !['api.cloudinary.com', 'api-eu.cloudinary.com', 'api-ap.cloudinary.com'].includes(parsed.hostname)) {
      throw new Error('Cloudinary generated an unexpected private download endpoint.');
    }
    const response = await this.fetcher(parsed, { redirect: 'follow', signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error('Cloudinary evidence download failed.');
    }
    return readBounded(response);
  }

  async remove(reference: EvidenceStorageReference): Promise<void> {
    assertCloudinaryReference(reference);
    const result = await this.sdk.uploader.destroy(reference.storagePath, {
      resource_type: reference.resourceType,
      type: reference.deliveryType,
      invalidate: true,
    });
    if (result?.result !== 'ok' && result?.result !== 'not found') throw new Error('Cloudinary evidence removal failed.');
  }
}
