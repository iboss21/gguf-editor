// Test-only helper that hand-packs raw GGUF byte buffers using Node's
// `Buffer` API. This is intentionally independent of `src/gguf/byte-writer.mjs`
// so that parser tests exercise a real, separately-implemented encoding of
// the format rather than only round-tripping against our own writer.

import { Buffer } from 'node:buffer';
import { GGUFValueType } from '../src/gguf/constants.mjs';

function packString(str) {
  const strBuf = Buffer.from(str, 'utf8');
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeBigUInt64LE(BigInt(strBuf.length));
  return Buffer.concat([lenBuf, strBuf]);
}

function packScalar(type, value) {
  const buf = Buffer.alloc(8); // oversized scratch, sliced per type
  switch (type) {
    case GGUFValueType.UINT8:
      buf.writeUInt8(value, 0);
      return buf.subarray(0, 1);
    case GGUFValueType.INT8:
      buf.writeInt8(value, 0);
      return buf.subarray(0, 1);
    case GGUFValueType.UINT16:
      buf.writeUInt16LE(value, 0);
      return buf.subarray(0, 2);
    case GGUFValueType.INT16:
      buf.writeInt16LE(value, 0);
      return buf.subarray(0, 2);
    case GGUFValueType.UINT32:
      buf.writeUInt32LE(value, 0);
      return buf.subarray(0, 4);
    case GGUFValueType.INT32:
      buf.writeInt32LE(value, 0);
      return buf.subarray(0, 4);
    case GGUFValueType.FLOAT32:
      buf.writeFloatLE(value, 0);
      return buf.subarray(0, 4);
    case GGUFValueType.FLOAT64:
      buf.writeDoubleLE(value, 0);
      return buf.subarray(0, 8);
    case GGUFValueType.UINT64:
      buf.writeBigUInt64LE(BigInt(value), 0);
      return buf.subarray(0, 8);
    case GGUFValueType.INT64:
      buf.writeBigInt64LE(BigInt(value), 0);
      return buf.subarray(0, 8);
    case GGUFValueType.BOOL:
      buf.writeUInt8(value ? 1 : 0, 0);
      return buf.subarray(0, 1);
    case GGUFValueType.STRING:
      return packString(value);
    default:
      throw new Error(`packScalar: unsupported type ${type}`);
  }
}

export function packValue(type, value) {
  if (type === GGUFValueType.ARRAY) {
    const { itemType, items } = value;
    const head = Buffer.alloc(12);
    head.writeUInt32LE(itemType, 0);
    head.writeBigUInt64LE(BigInt(items.length), 4);
    return Buffer.concat([head, ...items.map((it) => packValue(itemType, it))]);
  }
  return packScalar(type, value);
}

/**
 * @param {object} opts
 * @param {number} [opts.version]
 * @param {Array<{key:string,type:number,value:*}>} [opts.metadata]
 * @param {Array<{name:string,dims:bigint[],type:number,offset:bigint}>} [opts.tensorInfos] raw tensor-info records (offsets are relative, as on disk)
 * @param {Buffer} [opts.tensorData] raw bytes to append after the aligned data-start
 * @param {number} [opts.alignment] used only to compute padding before tensor data in this fixture
 * @param {Buffer} [opts.magic] override the 4 magic bytes (for corruption tests)
 */
export function buildRawGGUF({
  version = 3,
  metadata = [],
  tensorInfos = [],
  tensorData = Buffer.alloc(0),
  alignment = 32,
  magic = Buffer.from('GGUF', 'ascii'),
} = {}) {
  const header = Buffer.alloc(20);
  header.writeUInt32LE(version, 0);
  header.writeBigUInt64LE(BigInt(tensorInfos.length), 4);
  header.writeBigUInt64LE(BigInt(metadata.length), 12);

  const kvBufs = metadata.map(({ key, type, value }) => {
    const typeBuf = Buffer.alloc(4);
    typeBuf.writeUInt32LE(type, 0);
    return Buffer.concat([packString(key), typeBuf, packValue(type, value)]);
  });

  const tiBufs = tensorInfos.map(({ name, dims, type, offset }) => {
    const nameBuf = packString(name);
    const nDimsBuf = Buffer.alloc(4);
    nDimsBuf.writeUInt32LE(dims.length, 0);
    const dimsBuf = Buffer.concat(
      dims.map((d) => {
        const b = Buffer.alloc(8);
        b.writeBigUInt64LE(BigInt(d));
        return b;
      }),
    );
    const typeBuf = Buffer.alloc(4);
    typeBuf.writeUInt32LE(type, 0);
    const offsetBuf = Buffer.alloc(8);
    offsetBuf.writeBigUInt64LE(BigInt(offset));
    return Buffer.concat([nameBuf, nDimsBuf, dimsBuf, typeBuf, offsetBuf]);
  });

  const preData = Buffer.concat([magic, header, ...kvBufs, ...tiBufs]);
  const pad = (alignment - (preData.length % alignment)) % alignment;
  return Buffer.concat([preData, Buffer.alloc(pad), tensorData]);
}

/** Deterministic pseudo-random byte pattern, handy for verifying tensor data survives round-trips untouched. */
export function fillPattern(length, seed = 1) {
  const out = Buffer.alloc(length);
  let x = seed >>> 0 || 1;
  for (let i = 0; i < length; i++) {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    out[i] = x & 0xff;
  }
  return out;
}
