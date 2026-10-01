// QOA ("Quite OK Audio") codec, vendored from the GM0 audio scout (verified
// bit-exact against the phoboslab/qoa C decoder). Pure TS, no imports.
// Used by tools/transcode-audio.ts at build time to encode music; the runtime
// guest-side decoder ships with the kit. Implements the phoboslab/qoa spec
// (MIT, https://github.com/phoboslab/qoa):
// 20 samples per 64-bit slice, 256 slices per frame, sign-sign LMS predictor.
// File layout: "qoaf" + u32 samples, then frames
// (u64 frame header | per-channel 16-byte LMS | interleaved 8-byte slices).

const QOA_SLICE_LEN = 20;
const QOA_SLICES_PER_FRAME = 256;
const QOA_FRAME_LEN = QOA_SLICES_PER_FRAME * QOA_SLICE_LEN; // 5120
const QOA_LMS_LEN = 4;
const QOA_MAX_CHANNELS = 8;
const QOA_MAGIC = 0x716f6166; // "qoaf"

const QOA_QUANT_TAB: Int8Array = new Int8Array([
  7, 7, 7, 5, 5, 3, 3, 1,
  0,
  0, 2, 2, 4, 4, 6, 6, 6,
]);

const QOA_SCALEFACTOR_TAB: Int32Array = new Int32Array([
  1, 7, 21, 45, 84, 138, 211, 304, 421, 562, 731, 928, 1157, 1419, 1715, 2048,
]);

const QOA_RECIPROCAL_TAB: Int32Array = new Int32Array([
  65536, 9363, 3121, 1457, 781, 475, 311, 216, 156, 117, 90, 71, 57, 47, 39, 32,
]);

const QOA_DEQUANT_TAB: Int16Array = new Int16Array([
  1, -1, 3, -3, 5, -5, 7, -7,
  5, -5, 18, -18, 32, -32, 49, -49,
  16, -16, 53, -53, 95, -95, 147, -147,
  34, -34, 113, -113, 203, -203, 315, -315,
  63, -63, 210, -210, 378, -378, 588, -588,
  104, -104, 345, -345, 621, -621, 966, -966,
  158, -158, 528, -528, 950, -950, 1477, -1477,
  228, -228, 760, -760, 1368, -1368, 2128, -2128,
  316, -316, 1053, -1053, 1895, -1895, 2947, -2947,
  422, -422, 1405, -1405, 2529, -2529, 3934, -3934,
  548, -548, 1828, -1828, 3290, -3290, 5117, -5117,
  696, -696, 2320, -2320, 4176, -4176, 6496, -6496,
  868, -868, 2893, -2893, 5207, -5207, 8099, -8099,
  1064, -1064, 3548, -3548, 6386, -6386, 9933, -9933,
  1286, -1286, 4288, -4288, 7718, -7718, 12005, -12005,
  1536, -1536, 5120, -5120, 9216, -9216, 14336, -14336,
]);

interface Lms {
  history: Int32Array; // QOA_LMS_LEN
  weights: Int32Array; // QOA_LMS_LEN
}

function newLms(): Lms {
  return { history: new Int32Array(QOA_LMS_LEN), weights: new Int32Array(QOA_LMS_LEN) };
}

function lmsPredict(lms: Lms): number {
  let prediction = 0;
  for (let i = 0; i < QOA_LMS_LEN; i++) prediction += lms.weights[i] * lms.history[i];
  return prediction >> 13;
}

function lmsUpdate(lms: Lms, sample: number, residual: number): void {
  const delta = residual >> 4;
  for (let i = 0; i < QOA_LMS_LEN; i++) {
    lms.weights[i] += lms.history[i] < 0 ? -delta : delta;
  }
  for (let i = 0; i < QOA_LMS_LEN - 1; i++) lms.history[i] = lms.history[i + 1];
  lms.history[QOA_LMS_LEN - 1] = sample;
}

function qoaDiv(v: number, scalefactor: number): number {
  const reciprocal = QOA_RECIPROCAL_TAB[scalefactor];
  let n = (v * reciprocal + (1 << 15)) >> 16;
  n = n + ((v > 0 ? 1 : 0) - (v < 0 ? 1 : 0)) - ((n > 0 ? 1 : 0) - (n < 0 ? 1 : 0));
  return n;
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function clampS16(v: number): number {
  if (v > 32767) return 32767;
  if (v < -32768) return -32768;
  return v;
}

function writeU64(bytes: Uint8Array, p: number, v: bigint): number {
  // v may exceed 2^53? Slices pack 64 bits: sf(4) + 20*3 = 64 bits all used.
  // Use BigInt for safety on the encode path.
  bytes[p] = Number((v >> 56n) & 0xffn);
  bytes[p + 1] = Number((v >> 48n) & 0xffn);
  bytes[p + 2] = Number((v >> 40n) & 0xffn);
  bytes[p + 3] = Number((v >> 32n) & 0xffn);
  bytes[p + 4] = Number((v >> 24n) & 0xffn);
  bytes[p + 5] = Number((v >> 16n) & 0xffn);
  bytes[p + 6] = Number((v >> 8n) & 0xffn);
  bytes[p + 7] = Number(v & 0xffn);
  return p + 8;
}

function readU64(bytes: Uint8Array, p: number): bigint {
  return (
    (BigInt(bytes[p]) << 56n) |
    (BigInt(bytes[p + 1]) << 48n) |
    (BigInt(bytes[p + 2]) << 40n) |
    (BigInt(bytes[p + 3]) << 32n) |
    (BigInt(bytes[p + 4]) << 24n) |
    (BigInt(bytes[p + 5]) << 16n) |
    (BigInt(bytes[p + 6]) << 8n) |
    BigInt(bytes[p + 7])
  );
}

export function encodeQoa(samples: Int16Array, channels: number, rate: number): Uint8Array {
  if (samples.length === 0 || rate < 1 || rate > 0xffffff || channels < 1 || channels > QOA_MAX_CHANNELS) {
    throw new Error("bad qoa params");
  }
  const totalSamples = Math.floor(samples.length / channels); // per channel
  const numFrames = Math.ceil(totalSamples / QOA_FRAME_LEN);
  const numSlices = Math.ceil(totalSamples / QOA_SLICE_LEN);
  const encodedSize =
    8 + numFrames * 8 + numFrames * QOA_LMS_LEN * 4 * channels + numSlices * 8 * channels;
  const bytes = new Uint8Array(encodedSize);

  let p = writeU64(bytes, 0, (BigInt(QOA_MAGIC) << 32n) | BigInt(totalSamples));

  const lms: Lms[] = [];
  for (let c = 0; c < channels; c++) {
    const l = newLms();
    l.weights[0] = 0;
    l.weights[1] = 0;
    l.weights[2] = -(1 << 13);
    l.weights[3] = 1 << 14;
    lms.push(l);
  }

  const prevScalefactor = new Int32Array(channels);

  let frameStart = 0;
  while (frameStart < totalSamples) {
    const frameLen = clamp(QOA_FRAME_LEN, 0, totalSamples - frameStart);
    const slices = Math.ceil(frameLen / QOA_SLICE_LEN);
    const frameSize = 8 + QOA_LMS_LEN * 4 * channels + 8 * slices * channels;

    p = writeU64(
      bytes,
      p,
      (BigInt(channels) << 56n) | (BigInt(rate) << 32n) | (BigInt(frameLen) << 16n) | BigInt(frameSize),
    );

    for (let c = 0; c < channels; c++) {
      let history = 0n;
      let weights = 0n;
      for (let i = 0; i < QOA_LMS_LEN; i++) {
        history = (history << 16n) | BigInt(lms[c].history[i] & 0xffff);
        weights = (weights << 16n) | BigInt(lms[c].weights[i] & 0xffff);
      }
      p = writeU64(bytes, p, history);
      p = writeU64(bytes, p, weights);
    }

    for (let sliceStart = 0; sliceStart < frameLen; sliceStart += QOA_SLICE_LEN) {
      const sliceLen = clamp(QOA_SLICE_LEN, 0, frameLen - sliceStart);
      for (let c = 0; c < channels; c++) {
        let bestRank = Infinity;
        let bestSlice = 0n;
        let bestLms = newLms();
        let bestScalefactor = 0;

        for (let sfi0 = 0; sfi0 < 16; sfi0++) {
          const scalefactor = (sfi0 + prevScalefactor[c]) & 15;
          const trial: Lms = {
            history: Int32Array.from(lms[c].history),
            weights: Int32Array.from(lms[c].weights),
          };
          let slice = BigInt(scalefactor);
          let rank = 0;
          for (let si = 0; si < sliceLen; si++) {
            const sample = samples[(frameStart + sliceStart + si) * channels + c];
            const predicted = lmsPredict(trial);
            const residual = sample - predicted;
            const scaled = qoaDiv(residual, scalefactor);
            const clamped = clamp(scaled, -8, 8);
            const quantized = QOA_QUANT_TAB[clamped + 8];
            const dequantized = QOA_DEQUANT_TAB[scalefactor * 8 + quantized];
            const reconstructed = clampS16(predicted + dequantized);

            const w = trial.weights;
            let weightsPenalty =
              ((w[0] * w[0] + w[1] * w[1] + w[2] * w[2] + w[3] * w[3]) >> 18) - 0x8ff;
            if (weightsPenalty < 0) weightsPenalty = 0;

            const error = sample - reconstructed;
            rank += error * error + weightsPenalty * weightsPenalty;
            if (rank > bestRank) break;

            lmsUpdate(trial, reconstructed, dequantized);
            slice = (slice << 3n) | BigInt(quantized);
          }
          if (rank < bestRank) {
            bestRank = rank;
            bestSlice = slice;
            bestLms = trial;
            bestScalefactor = scalefactor;
          }
        }

        prevScalefactor[c] = bestScalefactor;
        lms[c] = bestLms;
        bestSlice <<= BigInt((QOA_SLICE_LEN - sliceLen) * 3);
        p = writeU64(bytes, p, bestSlice);
      }
    }
    frameStart += frameLen;
  }

  if (p !== encodedSize) throw new Error(`qoa size mismatch: wrote ${p}, expected ${encodedSize}`);
  return bytes;
}

export function decodeQoa(bytes: Uint8Array): { samples: Int16Array; channels: number; rate: number } {
  if (bytes.length < 16) throw new Error("qoa too short");
  const fileHeader = readU64(bytes, 0);
  if (fileHeader >> 32n !== BigInt(QOA_MAGIC)) throw new Error("bad qoaf magic");
  const totalSamples = Number(fileHeader & 0xffffffffn);

  let p = 8;
  const frameHeader = readU64(bytes, p);
  const channels = Number(frameHeader >> 56n);
  const rate = Number((frameHeader >> 32n) & 0xffffffn);
  if (channels < 1 || channels > QOA_MAX_CHANNELS || rate < 1) throw new Error("bad qoa frame header");

  const out = new Int16Array(totalSamples * channels);
  const lms: Lms[] = [];
  for (let c = 0; c < channels; c++) lms.push(newLms());

  let outPos = 0;
  while (p < bytes.length) {
    const fh = readU64(bytes, p);
    const fChannels = Number(fh >> 56n);
    const fRate = Number((fh >> 32n) & 0xffffffn);
    const frameLen = Number((fh >> 16n) & 0xffffn);
    const frameSize = Number(fh & 0xffffn);
    if (fChannels !== channels || fRate !== rate || frameSize === 0) break;
    let q = p + 8;

    for (let c = 0; c < channels; c++) {
      const history = readU64(bytes, q);
      const weights = readU64(bytes, q + 8);
      q += 16;
      for (let i = 0; i < QOA_LMS_LEN; i++) {
        lms[c].history[i] = Number((history >> BigInt((3 - i) * 16)) & 0xffffn) << 16 >> 16;
        lms[c].weights[i] = Number((weights >> BigInt((3 - i) * 16)) & 0xffffn) << 16 >> 16;
      }
    }

    const slices = Math.ceil(frameLen / QOA_SLICE_LEN);
    for (let s = 0; s < slices; s++) {
      const sliceLen = clamp(QOA_SLICE_LEN, 0, frameLen - s * QOA_SLICE_LEN);
      for (let c = 0; c < channels; c++) {
        const slice = readU64(bytes, q);
        q += 8;
        const scalefactor = Number(slice >> 60n);
        for (let i = 0; i < sliceLen; i++) {
          const quantized = Number((slice >> BigInt(57 - i * 3)) & 0x7n);
          const predicted = lmsPredict(lms[c]);
          const residual = QOA_DEQUANT_TAB[scalefactor * 8 + quantized];
          const sample = clampS16(predicted + residual);
          out[outPos++] = sample;
          lmsUpdate(lms[c], sample, residual);
        }
      }
    }
    p += frameSize;
  }

  return { samples: out.subarray(0, outPos), channels, rate };
}
