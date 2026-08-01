import test from 'node:test';
import assert from 'node:assert/strict';
import { ByteReader, BufferUnderrunError } from '../src/gguf/byte-reader.mjs';
import { ByteWriter } from '../src/gguf/byte-writer.mjs';

test('ByteWriter/ByteReader round-trip every primitive type', () => {
  const w = new ByteWriter();
  w.writeUint8(200);
  w.writeInt8(-100);
  w.writeUint16(60000);
  w.writeInt16(-30000);
  w.writeUint32(4000000000);
  w.writeInt32(-2000000000);
  w.writeUint64(18446744073709551615n);
  w.writeInt64(-9223372036854775808n);
  w.writeFloat32(3.5);
  w.writeFloat64(Math.PI);
  w.writeBool(true);
  w.writeBool(false);
  w.writeString('hello');
  w.writeString('emoji 🎉 and ünïcödé');

  const r = new ByteReader(w.toUint8Array());
  assert.equal(r.readUint8(), 200);
  assert.equal(r.readInt8(), -100);
  assert.equal(r.readUint16(), 60000);
  assert.equal(r.readInt16(), -30000);
  assert.equal(r.readUint32(), 4000000000);
  assert.equal(r.readInt32(), -2000000000);
  assert.equal(r.readUint64(), 18446744073709551615n);
  assert.equal(r.readInt64(), -9223372036854775808n);
  assert.equal(r.readFloat32(), 3.5);
  assert.equal(r.readFloat64(), Math.PI);
  assert.equal(r.readBool(), true);
  assert.equal(r.readBool(), false);
  assert.equal(r.readString(), 'hello');
  assert.equal(r.readString(), 'emoji 🎉 and ünïcödé');
  assert.equal(r.remaining, 0);
});

test('ByteWriter writeZeros pads with zero bytes', () => {
  const w = new ByteWriter();
  w.writeUint8(1);
  w.writeZeros(3);
  w.writeUint8(2);
  const bytes = w.toUint8Array();
  assert.deepEqual(Array.from(bytes), [1, 0, 0, 0, 2]);
});

test('ByteReader throws BufferUnderrunError instead of returning garbage', () => {
  const r = new ByteReader(new Uint8Array([1, 2, 3]));
  r.readUint16();
  assert.throws(() => r.readUint32(), BufferUnderrunError);
});

test('ByteReader.readString rejects when declared length exceeds available bytes', () => {
  const w = new ByteWriter();
  w.writeUint64(1000n); // claim a 1000-byte string
  w.writeBytes(new Uint8Array([1, 2, 3])); // but only supply 3 bytes
  const r = new ByteReader(w.toUint8Array());
  assert.throws(() => r.readString(), BufferUnderrunError);
});

test('ByteReader tracks offset/remaining correctly', () => {
  const r = new ByteReader(new Uint8Array(10));
  assert.equal(r.remaining, 10);
  r.skip(4);
  assert.equal(r.offset, 4);
  assert.equal(r.remaining, 6);
  r.readBytes(6);
  assert.equal(r.remaining, 0);
});
