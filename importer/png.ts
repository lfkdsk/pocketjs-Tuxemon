// Build-time PNG decoder used by the Tuxemon terrain importer.  PocketJS's
// decoder deliberately excludes indexed PNGs, while most of Tuxemon's old
// tilesheets are 4/8-bit palette PNGs.  This keeps the importer dependency-
// free and expands every supported source losslessly to straight RGBA.

import { inflateSync } from "node:zlib";

export interface RgbaImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

function concat(parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function sampleAt(row: Uint8Array, x: number, bitDepth: number): number {
  if (bitDepth === 8) return row[x]!;
  const perByte = 8 / bitDepth;
  const shift = (perByte - 1 - (x % perByte)) * bitDepth;
  return (row[Math.floor(x / perByte)]! >>> shift) & ((1 << bitDepth) - 1);
}

/** Decode non-interlaced 8-bit RGB/RGBA/gray and 1/2/4/8-bit indexed PNG. */
export function decodePng(bytes: Uint8Array, label = "<png>"): RgbaImage {
  try {
    for (let i = 0; i < SIGNATURE.length; i++) {
      if (bytes[i] !== SIGNATURE[i]) throw new Error("bad signature");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let cursor = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = -1;
    let palette: Uint8Array | null = null;
    let transparency: Uint8Array | null = null;
    const idat: Uint8Array[] = [];
    while (cursor + 12 <= bytes.length) {
      const length = view.getUint32(cursor, false);
      const end = cursor + 12 + length;
      if (end > bytes.length) throw new Error("truncated chunk");
      const type = String.fromCharCode(
        bytes[cursor + 4]!, bytes[cursor + 5]!, bytes[cursor + 6]!, bytes[cursor + 7]!,
      );
      const body = bytes.subarray(cursor + 8, cursor + 8 + length);
      if (type === "IHDR") {
        width = view.getUint32(cursor + 8, false);
        height = view.getUint32(cursor + 12, false);
        bitDepth = bytes[cursor + 16]!;
        colorType = bytes[cursor + 17]!;
        if (bytes[cursor + 20] !== 0) throw new Error("interlaced PNGs are unsupported");
      } else if (type === "PLTE") {
        palette = body.slice();
      } else if (type === "tRNS") {
        transparency = body.slice();
      } else if (type === "IDAT") {
        idat.push(body);
      } else if (type === "IEND") {
        break;
      }
      cursor = end;
    }
    if (width < 1 || height < 1) throw new Error(`bad dimensions ${width}x${height}`);
    const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType];
    if (!channels) throw new Error(`unsupported color type ${colorType}`);
    if (colorType === 3) {
      if (![1, 2, 4, 8].includes(bitDepth)) throw new Error(`unsupported palette bit depth ${bitDepth}`);
      if (!palette || palette.length % 3 !== 0) throw new Error("indexed PNG has no valid PLTE");
    } else if (bitDepth !== 8) {
      throw new Error(`only indexed PNGs may use bit depth ${bitDepth}`);
    }

    const bitsPerPixel = channels * bitDepth;
    const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
    const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
    const raw = new Uint8Array(inflateSync(concat(idat)));
    if (raw.length !== (rowBytes + 1) * height) {
      throw new Error(`inflated ${raw.length} bytes, expected ${(rowBytes + 1) * height}`);
    }
    const rows: Uint8Array[] = [];
    let rawOffset = 0;
    let previous = new Uint8Array(rowBytes);
    for (let y = 0; y < height; y++) {
      const filter = raw[rawOffset++]!;
      const row = new Uint8Array(rowBytes);
      for (let x = 0; x < rowBytes; x++) {
        const source = raw[rawOffset + x]!;
        const left = x >= bytesPerPixel ? row[x - bytesPerPixel]! : 0;
        const up = previous[x]!;
        const upperLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel]! : 0;
        let value: number;
        if (filter === 0) value = source;
        else if (filter === 1) value = source + left;
        else if (filter === 2) value = source + up;
        else if (filter === 3) value = source + ((left + up) >> 1);
        else if (filter === 4) value = source + paeth(left, up, upperLeft);
        else throw new Error(`bad filter ${filter}`);
        row[x] = value & 0xff;
      }
      rawOffset += rowBytes;
      rows.push(row);
      previous = row;
    }

    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
      const row = rows[y]!;
      for (let x = 0; x < width; x++) {
        const dest = (y * width + x) * 4;
        if (colorType === 3) {
          const index = sampleAt(row, x, bitDepth);
          const source = index * 3;
          if (source + 2 >= palette!.length) throw new Error(`palette index ${index} outside PLTE`);
          rgba[dest] = palette![source]!;
          rgba[dest + 1] = palette![source + 1]!;
          rgba[dest + 2] = palette![source + 2]!;
          rgba[dest + 3] = transparency?.[index] ?? 255;
          continue;
        }
        const source = x * channels;
        if (colorType === 0) {
          rgba[dest] = rgba[dest + 1] = rgba[dest + 2] = row[source]!;
          rgba[dest + 3] = 255;
        } else if (colorType === 2) {
          rgba[dest] = row[source]!;
          rgba[dest + 1] = row[source + 1]!;
          rgba[dest + 2] = row[source + 2]!;
          rgba[dest + 3] = 255;
        } else if (colorType === 4) {
          rgba[dest] = rgba[dest + 1] = rgba[dest + 2] = row[source]!;
          rgba[dest + 3] = row[source + 1]!;
        } else {
          rgba[dest] = row[source]!;
          rgba[dest + 1] = row[source + 1]!;
          rgba[dest + 2] = row[source + 2]!;
          rgba[dest + 3] = row[source + 3]!;
        }
      }
    }
    return { width, height, rgba };
  } catch (error) {
    throw new Error(`${label}: png: ${error instanceof Error ? error.message : String(error)}`);
  }
}
