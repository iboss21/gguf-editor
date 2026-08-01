// Low-level, cursor-based binary reader used by the GGUF parser.
//
// All GGUF integers/floats are little-endian. 64-bit fields are read as
// BigInt to avoid precision loss, since tensor offsets/lengths can
// legitimately exceed Number.MAX_SAFE_INTEGER for very large models.

const textDecoder = new TextDecoder('utf-8', { fatal: false });

/** Thrown when a read would go past the end of the available buffer. */
export class BufferUnderrunError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BufferUnderrunError';
  }
}

export class ByteReader {
  /** @param {ArrayBuffer|Uint8Array} data */
  constructor(data) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
    this.offset = 0;
  }

  get length() {
    return this.bytes.byteLength;
  }

  get remaining() {
    return this.length - this.offset;
  }

  _need(n) {
    if (this.offset + n > this.length) {
      throw new BufferUnderrunError(
        `Unexpected end of data: need ${n} more byte(s) at offset ${this.offset}, only ${this.remaining} available`,
      );
    }
  }

  skip(n) {
    this._need(n);
    this.offset += n;
  }

  readBytes(n) {
    this._need(n);
    const slice = this.bytes.slice(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  readUint8() {
    this._need(1);
    const v = this.view.getUint8(this.offset);
    this.offset += 1;
    return v;
  }

  readInt8() {
    this._need(1);
    const v = this.view.getInt8(this.offset);
    this.offset += 1;
    return v;
  }

  readUint16() {
    this._need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readInt16() {
    this._need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  readUint32() {
    this._need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readInt32() {
    this._need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readUint64() {
    this._need(8);
    const v = this.view.getBigUint64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readInt64() {
    this._need(8);
    const v = this.view.getBigInt64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readFloat32() {
    this._need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  readFloat64() {
    this._need(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  readBool() {
    return this.readUint8() !== 0;
  }

  /** GGUF strings are a uint64 byte length followed by raw UTF-8 bytes (no NUL terminator). */
  readString() {
    const len = this.readUint64();
    if (len > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`String length ${len} is too large to handle`);
    }
    const bytes = this.readBytes(Number(len));
    return textDecoder.decode(bytes);
  }
}
