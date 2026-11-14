import { deflateSync } from 'node:zlib';
function chunk(type: string, data: Buffer) {
  const content = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
  for (const byte of content) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, content, checksum]);
}
const header = Buffer.from([0,0,0,1,0,0,0,1,8,2,0,0,0]);
export const photo = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0,255,0,0]))), chunk('IEND', Buffer.alloc(0))]);

export function pngWithDimensions(width: number, height: number): Buffer {
  const imageHeader = Buffer.alloc(13);
  imageHeader.writeUInt32BE(width, 0); imageHeader.writeUInt32BE(height, 4);
  imageHeader[8] = 8; imageHeader[9] = 2;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', imageHeader), photo.subarray(33)]);
}

export function jpegWithDimensions(width: number, height: number): Buffer {
  const dimensions = Buffer.alloc(9);
  dimensions[0] = 8; dimensions.writeUInt16BE(height, 1); dimensions.writeUInt16BE(width, 3);
  dimensions.set([1, 1, 0x11, 0], 5);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b]), dimensions,
    Buffer.from([0xff, 0xda, 0x00, 0x02, 0x01, 0xff, 0xd9]),
  ]);
}
