import { expect, it } from 'vitest';
import { validatePhoto, MAX_PHOTO_BYTES } from '../src/modules/evidence/photo-validation.js';
import { LocalEvidenceStorage } from '../src/modules/evidence/local-evidence-storage.js';
import { authorizeEvidenceUpload } from '../src/modules/evidence/evidence-service.js';
import { jpegWithDimensions, photo, pngWithDimensions } from './evidence-fixture.js';
it('accepts a structurally valid PNG independently of client metadata', () => { expect(validatePhoto(photo).fileType).toBe('image/png'); });
it.each([Buffer.from('MZ executable'), Buffer.from('<svg onload="alert(1)"/>'), Buffer.from('<script>alert(1)</script>'), photo.subarray(0, 40), Buffer.concat([photo, Buffer.from('MZ')])])('rejects executable, active, truncated and appended content', bytes => { expect(() => validatePhoto(bytes)).toThrow(); });
it('rejects oversized images and bad CRCs', () => {
  expect(() => validatePhoto(Buffer.alloc(MAX_PHOTO_BYTES + 1))).toThrow();
  const corrupt = Buffer.from(photo); corrupt[30] ^= 1; expect(() => validatePhoto(corrupt)).toThrow();
});
it.each([['PNG', pngWithDimensions], ['JPEG', jpegWithDimensions]] as const)('accepts exactly 25 megapixels and rejects larger %s images clearly', (_type, makeImage) => {
  expect(validatePhoto(makeImage(5000, 5000))).toBeDefined();
  expect(() => validatePhoto(makeImage(5001, 5000))).toThrow(expect.objectContaining({ code: 'IMAGE_DIMENSIONS_TOO_LARGE', status: 413, message: expect.stringContaining('25 megapixels') }));
});
it('refuses traversal keys before touching storage', async () => { await expect(new LocalEvidenceStorage().read({ provider: 'local', storagePath: '../../.env' })).rejects.toThrow('storage key'); });
it('enforces initial/repair/resolution evidence categories', () => {
  const resident = { userId: 'id', societyId: 'society', role: 'RESIDENT' as const };
  const manager = { ...resident, role: 'SOCIETY_MANAGER' as const };
  expect(authorizeEvidenceUpload(resident, 'OPEN', 'COMPLAINT_PHOTO')).toBe('COMPLAINT_PHOTO');
  expect(() => authorizeEvidenceUpload(resident, 'RESOLVED', 'AFTER_PHOTO')).toThrow();
  expect(authorizeEvidenceUpload(manager, 'RESOLVED', 'AFTER_PHOTO')).toBe('AFTER_PHOTO');
  expect(() => authorizeEvidenceUpload(manager, 'CLOSED', 'AFTER_PHOTO')).toThrow();
});
