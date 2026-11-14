import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { CloudinaryEvidenceStorage } from '../src/modules/evidence/cloudinary-evidence-storage.js';
import { photo, pngWithDimensions } from './evidence-fixture.js';

const configuration = { cloudName: 'nivaas-test', apiKey: 'test-api-key', apiSecret: 'test-api-secret-not-real' };
const uploadResult = {
  public_id: 'nivaas-evidence/7c5b66e0-0d45-4317-9a5a-c684f704a8de',
  asset_id: 'abcdefghijklmno1234567890',
  resource_type: 'image', type: 'authenticated', format: 'png', version: 123456,
  bytes: photo.length,
};

function fakeSdk(result?: typeof uploadResult) {
  const uploaded: Buffer[] = [];
  const uploadStream = vi.fn((options: { public_id: string }, callback: (error: Error | null, response?: unknown) => void) => {
    const stream = new Writable({ write(chunk, _encoding, done) { uploaded.push(Buffer.from(chunk)); done(); } });
    stream.once('finish', () => callback(null, { ...(result ?? uploadResult), public_id: result?.public_id ?? options.public_id }));
    return stream;
  });
  const destroy = vi.fn().mockResolvedValue({ result: 'ok' });
  const privateDownloadUrl = vi.fn().mockReturnValue('https://api.cloudinary.com/v1_1/nivaas-test/image/authenticated/s--signature--/nivaas-evidence/item.png?expires_at=123');
  const sdk = { config: vi.fn(), uploader: { upload_stream: uploadStream, destroy }, utils: { private_download_url: privateDownloadUrl } };
  return { sdk, uploaded, uploadStream, destroy, privateDownloadUrl };
}

describe('authenticated Cloudinary evidence storage', () => {
  it('uploads validated bytes through the signed server SDK as a private authenticated image', async () => {
    const fake = fakeSdk();
    const storage = new CloudinaryEvidenceStorage(configuration, fake.sdk as never);
    const reference = await storage.write(photo);
    expect(fake.sdk.config).toHaveBeenCalledWith({ cloud_name: configuration.cloudName, api_key: configuration.apiKey, api_secret: configuration.apiSecret, secure: true });
    expect(fake.uploadStream).toHaveBeenCalledWith(expect.objectContaining({
      resource_type: 'image', type: 'authenticated', public_id: expect.stringMatching(/^nivaas-evidence\/[0-9a-f-]{36}$/),
      allowed_formats: ['jpg', 'png'], overwrite: false, discard_original_filename: true,
    }), expect.any(Function));
    expect(Buffer.concat(fake.uploaded)).toEqual(photo);
    expect(reference).toMatchObject({ provider: 'cloudinary', storagePath: expect.stringMatching(/^nivaas-evidence\/[0-9a-f-]{36}$/), assetId: uploadResult.asset_id, resourceType: 'image', deliveryType: 'authenticated', format: 'png', version: 123456 });
    expect(reference).not.toHaveProperty('url');
  });

  it('rejects unsupported or oversized bytes before contacting Cloudinary', async () => {
    const fake = fakeSdk(); const storage = new CloudinaryEvidenceStorage(configuration, fake.sdk as never);
    await expect(storage.write(Buffer.from('not an image'))).rejects.toMatchObject({ code: 'UNSUPPORTED_FILE_TYPE' });
    await expect(storage.write(Buffer.alloc(5 * 1024 * 1024 + 1))).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });
    await expect(storage.write(pngWithDimensions(5001, 5000))).rejects.toMatchObject({ code: 'IMAGE_DIMENSIONS_TOO_LARGE' });
    expect(fake.uploadStream).not.toHaveBeenCalled();
  });

  it('downloads only via a short-lived authenticated SDK URL and bounds returned bytes', async () => {
    const fake = fakeSdk(); const fetcher = vi.fn().mockResolvedValue(new Response(photo, { headers: { 'content-length': String(photo.length) } }));
    const storage = new CloudinaryEvidenceStorage(configuration, fake.sdk as never, fetcher as never);
    const reference = { provider: 'cloudinary' as const, storagePath: uploadResult.public_id, assetId: uploadResult.asset_id, resourceType: 'image' as const, deliveryType: 'authenticated' as const, format: 'png' as const, version: uploadResult.version };
    await expect(storage.read(reference)).resolves.toEqual(photo);
    expect(fake.privateDownloadUrl).toHaveBeenCalledWith(reference.storagePath, 'png', expect.objectContaining({ resource_type: 'image', type: 'authenticated', expires_at: expect.any(Number) }));
    expect(fetcher).toHaveBeenCalledTimes(1);

    const oversizedFetch = vi.fn().mockResolvedValue(new Response(Buffer.alloc(5 * 1024 * 1024 + 1)));
    await expect(new CloudinaryEvidenceStorage(configuration, fake.sdk as never, oversizedFetch as never).read(reference)).rejects.toThrow(/file size/);
  });

  it('deletes the exact stored private asset reference', async () => {
    const fake = fakeSdk(); const storage = new CloudinaryEvidenceStorage(configuration, fake.sdk as never);
    const reference = { provider: 'cloudinary' as const, storagePath: uploadResult.public_id, assetId: uploadResult.asset_id, resourceType: 'image' as const, deliveryType: 'authenticated' as const, format: 'png' as const, version: uploadResult.version };
    await storage.remove(reference);
    expect(fake.destroy).toHaveBeenCalledExactlyOnceWith(uploadResult.public_id, { resource_type: 'image', type: 'authenticated', invalidate: true });
  });
});
