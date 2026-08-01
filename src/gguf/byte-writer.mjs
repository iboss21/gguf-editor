// Low-level, append-only binary writer used by the GGUF serializer.
//
// Bytes are accumulated as a list of Uint8Array chunks and concatenated
// once at the end, so writing is O(1) per call instead of repeatedly
// growing/copying a single buffer.

const textEncoder = new TextEncoder();

export class ByteWriter {
  constructor() {
    /** @type {Uint8Array[]} */
    this.chunks = [];
    this.length = 0;
  }

  _push(bytes) {
    this.chunks.push(bytes);
    this.length += bytes.length;
  }

  writeBytes(bytes) {
    this._push(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  }

  writeZeros(n) {
    if (n > 0) this._push(new Uint8Array(n));
  }

  _scratch(size) {
    const buf = new ArrayBuffer(size);
    return [new Uint8Array(buf), new DataView(buf)];
  }

  writeUint8(v) {
    const [u8, dv] = this._scratch(1);
    dv.setUint8(0, v);
    this._push(u8);
  }

  writeInt8(v) {
    const [u8, dv] = this._scratch(1);
    dv.setInt8(0, v);
    this._push(u8);
  }

  writeUint16(v) {
    const [u8, dv] = this._scratch(2);
    dv.setUint16(0, v, true);
    this._push(u8);
  }

  writeInt16(v) {
    const [u8, dv] = this._scratch(2);
    dv.setInt16(0, v, true);
    this._push(u8);
  }

  writeUint32(v) {
    const [u8, dv] = this._scratch(4);
    dv.setUint32(0, v, true);
    this._push(u8);
  }

  writeInt32(v) {
    const [u8, dv] = this._scratch(4);
    dv.setInt32(0, v, true);
    this._push(u8);
  }

  writeUint64(v) {
    const [u8, dv] = this._scratch(8);
    dv.setBigUint64(0, BigInt(v), true);
    this._push(u8);
  }

  writeInt64(v) {
    const [u8, dv] = this._scratch(8);
    dv.setBigInt64(0, BigInt(v), true);
    this._push(u8);
  }

  writeFloat32(v) {
    const [u8, dv] = this._scratch(4);
    dv.setFloat32(0, v, true);
    this._push(u8);
  }

  writeFloat64(v) {
    const [u8, dv] = this._scratch(8);
    dv.setFloat64(0, v, true);
    this._push(u8);
  }

  writeBool(v) {
    this.writeUint8(v ? 1 : 0);
  }

  /** GGUF strings are a uint64 byte length followed by raw UTF-8 bytes. */
  writeString(str) {
    const bytes = textEncoder.encode(String(str));
    this.writeUint64(BigInt(bytes.length));
    this.writeBytes(bytes);
  }

  toUint8Array() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}
