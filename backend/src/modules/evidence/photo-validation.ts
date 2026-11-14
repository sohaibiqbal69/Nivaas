import { ApiError } from '../../lib/api-error.js';

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 25_000_000;
const invalid = () => new ApiError(415, 'UNSUPPORTED_FILE_TYPE', 'Upload a complete JPEG or PNG photo. Executables, SVG and other formats are not accepted.');
const dimensionsTooLarge = () => new ApiError(413, 'IMAGE_DIMENSIONS_TOO_LARGE', 'Photos must be no larger than 25 megapixels (25 million pixels).');

function validateDimensions(width: number, height: number): void {
  if (!width || !height) throw invalid();
  if (width * height > MAX_PHOTO_PIXELS) throw dimensionsTooLarge();
}

/** Inspect bytes, never the submitted filename or Content-Type. No image code is executed. */
export function validatePhoto(bytes: Buffer): { fileType: string; extension: string } {
  if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new ApiError(413, 'FILE_TOO_LARGE', 'Photos must contain data and be no larger than 5 MiB.');
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    let position = 8; let header = false; let data = false;
    while (position + 12 <= bytes.length) {
      const length = bytes.readUInt32BE(position);
      const end = position + 12 + length;
      if (end > bytes.length) throw invalid();
      const type = bytes.toString('ascii', position + 4, position + 8);
      if (!/^[A-Za-z]{4}$/.test(type)) throw invalid();
      if (crc32(bytes.subarray(position + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) throw invalid();
      if (!header) {
        if (type !== 'IHDR' || length !== 13) throw invalid();
        const width = bytes.readUInt32BE(position + 8); const height = bytes.readUInt32BE(position + 12);
        validateDimensions(width, height);
        header = true;
      } else if (type === 'IHDR') throw invalid();
      if (type === 'IDAT') data = true;
      if (type === 'IEND') {
        if (length !== 0 || end !== bytes.length || !data) throw invalid();
        return { fileType: 'image/png', extension: 'png' };
      }
      position = end;
    }
    throw invalid();
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let position = 2; let frame = false; let scan = false;
    while (position < bytes.length) {
      if (bytes[position++] !== 0xff) throw invalid();
      while (bytes[position] === 0xff) position++;
      const marker = bytes[position++];
      if (marker === 0xd9) {
        if (!frame || !scan || position !== bytes.length) throw invalid();
        return { fileType: 'image/jpeg', extension: 'jpg' };
      }
      if (marker === undefined || marker === 0 || marker === 0xd8 || position + 2 > bytes.length) throw invalid();
      const length = bytes.readUInt16BE(position);
      if (length < 2 || position + length > bytes.length) throw invalid();
      if ([0xc0, 0xc1, 0xc2].includes(marker)) {
        if (length < 8) throw invalid();
        const height = bytes.readUInt16BE(position + 3); const width = bytes.readUInt16BE(position + 5);
        validateDimensions(width, height);
        frame = true;
      }
      position += length;
      if (marker === 0xda) {
        if (!frame) throw invalid();
        scan = true;
        while (position < bytes.length) {
          if (bytes[position] !== 0xff) { position++; continue; }
          const next = bytes[position + 1];
          if (next === 0 || (next >= 0xd0 && next <= 0xd7)) { position += 2; continue; }
          break;
        }
      }
    }
  }
  throw invalid();
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
