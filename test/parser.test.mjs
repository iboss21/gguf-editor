import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { parseGGUF, GGUFParseError } from '../src/gguf/parser.mjs';
import { GGUFValueType, GGMLType } from '../src/gguf/constants.mjs';
import { buildRawGGUF, fillPattern } from './fixtures.mjs';

test('parseGGUF: minimal file with no metadata and no tensors', async () => {
  const buf = buildRawGGUF({ version: 3 });
  const model = await parseGGUF(buf);
  assert.equal(model.version, 3);
  assert.equal(model.alignment, 32);
  assert.deepEqual(model.metadata, []);
  assert.deepEqual(model.tensors, []);
});

test('parseGGUF: rejects bad magic number', async () => {
  const buf = buildRawGGUF({ magic: Buffer.from('BADM', 'ascii') });
  await assert.rejects(() => parseGGUF(buf), GGUFParseError);
});

test('parseGGUF: rejects unsupported version', async () => {
  const buf = buildRawGGUF({ version: 1 });
  await assert.rejects(() => parseGGUF(buf), /Unsupported GGUF version/);
});

test('parseGGUF: rejects a file too small to contain a header', async () => {
  await assert.rejects(() => parseGGUF(new Uint8Array([1, 2, 3])), GGUFParseError);
});

test('parseGGUF: rejects truncated metadata section', async () => {
  const full = buildRawGGUF({
    metadata: [{ key: 'general.name', type: GGUFValueType.STRING, value: 'test-model-name' }],
  });
  // Cut well inside the metadata's value string (not just the trailing alignment
  // padding), so the whole truncated buffer is the "file" and there is nothing
  // left to grow into.
  const truncated = full.subarray(0, 50);
  await assert.rejects(() => parseGGUF(truncated), GGUFParseError);
});

test('parseGGUF: reads every scalar metadata value type correctly', async () => {
  const metadata = [
    { key: 'k.uint8', type: GGUFValueType.UINT8, value: 250 },
    { key: 'k.int8', type: GGUFValueType.INT8, value: -100 },
    { key: 'k.uint16', type: GGUFValueType.UINT16, value: 60000 },
    { key: 'k.int16', type: GGUFValueType.INT16, value: -30000 },
    { key: 'k.uint32', type: GGUFValueType.UINT32, value: 4000000000 },
    { key: 'k.int32', type: GGUFValueType.INT32, value: -2000000000 },
    { key: 'k.float32', type: GGUFValueType.FLOAT32, value: Math.fround(1.5) },
    { key: 'k.float64', type: GGUFValueType.FLOAT64, value: Math.PI },
    { key: 'k.uint64', type: GGUFValueType.UINT64, value: 18446744073709551615n },
    { key: 'k.int64', type: GGUFValueType.INT64, value: -9223372036854775808n },
    { key: 'k.bool_true', type: GGUFValueType.BOOL, value: true },
    { key: 'k.bool_false', type: GGUFValueType.BOOL, value: false },
    { key: 'k.string', type: GGUFValueType.STRING, value: 'a unicode string 🎉' },
  ];
  const buf = buildRawGGUF({ metadata });
  const model = await parseGGUF(buf);
  assert.equal(model.metadata.length, metadata.length);
  for (let i = 0; i < metadata.length; i++) {
    assert.equal(model.metadata[i].key, metadata[i].key);
    assert.equal(model.metadata[i].type, metadata[i].type);
    assert.equal(model.metadata[i].value, metadata[i].value);
  }
});

test('parseGGUF: reads array metadata values (including empty and string arrays)', async () => {
  const metadata = [
    {
      key: 'k.arr.u32',
      type: GGUFValueType.ARRAY,
      value: { itemType: GGUFValueType.UINT32, items: [1, 2, 3, 4] },
    },
    {
      key: 'k.arr.str',
      type: GGUFValueType.ARRAY,
      value: { itemType: GGUFValueType.STRING, items: ['alpha', 'beta', 'gamma'] },
    },
    {
      key: 'k.arr.empty',
      type: GGUFValueType.ARRAY,
      value: { itemType: GGUFValueType.FLOAT32, items: [] },
    },
  ];
  const buf = buildRawGGUF({ metadata });
  const model = await parseGGUF(buf);
  assert.deepEqual(model.metadata[0].value, { itemType: GGUFValueType.UINT32, items: [1, 2, 3, 4] });
  assert.deepEqual(model.metadata[1].value, {
    itemType: GGUFValueType.STRING,
    items: ['alpha', 'beta', 'gamma'],
  });
  assert.deepEqual(model.metadata[2].value, { itemType: GGUFValueType.FLOAT32, items: [] });
});

test('parseGGUF: computes tensor byte length, file offsets, and honors custom alignment', async () => {
  const alignment = 64;
  // tensor.a: 16 x F32 = 64 bytes (already aligned to 64).
  // tensor.b: 8 x F16 = 16 bytes, placed right after tensor.a at offset 64 (also aligned to 64).
  const tensorInfos = [
    { name: 'tensor.a', dims: [16n], type: GGMLType.F32, offset: 0n },
    { name: 'tensor.b', dims: [8n], type: GGMLType.F16, offset: 64n },
  ];
  const tensorData = Buffer.concat([fillPattern(64, 1), fillPattern(16, 2)]);
  const buf = buildRawGGUF({
    metadata: [{ key: 'general.alignment', type: GGUFValueType.UINT32, value: alignment }],
    tensorInfos,
    tensorData,
    alignment,
  });

  const model = await parseGGUF(buf);
  assert.equal(model.alignment, 64);
  assert.equal(model.tensors.length, 2);
  assert.equal(model.tensors[0].length, 64n);
  assert.equal(model.tensors[1].length, 16n);
  assert.equal(model.tensors[1].fileOffset - model.tensors[0].fileOffset, 64n);
  assert.equal(model.dataStart % 64n, 0n);

  // Verify the bytes at the computed offsets match what we wrote.
  const wholeBuf = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  const aBytes = wholeBuf.slice(
    Number(model.tensors[0].fileOffset),
    Number(model.tensors[0].fileOffset + model.tensors[0].length),
  );
  const bBytes = wholeBuf.slice(
    Number(model.tensors[1].fileOffset),
    Number(model.tensors[1].fileOffset + model.tensors[1].length),
  );
  assert.deepEqual(Array.from(aBytes), Array.from(fillPattern(64, 1)));
  assert.deepEqual(Array.from(bBytes), Array.from(fillPattern(16, 2)));
});

test('parseGGUF: rejects a file where tensor data would run past EOF', async () => {
  const tensorInfos = [{ name: 't', dims: [1024n], type: GGMLType.F32, offset: 0n }]; // needs 4096 bytes
  const buf = buildRawGGUF({ tensorInfos, tensorData: Buffer.alloc(10) }); // far too little data
  await assert.rejects(() => parseGGUF(buf), /extends past the end of the file/);
});

test('parseGGUF: adaptively grows the read window for large metadata sections', async () => {
  // A long description forces the metadata section past a tiny initial chunk size.
  const longValue = 'x'.repeat(200_000);
  const buf = buildRawGGUF({
    metadata: [{ key: 'general.description', type: GGUFValueType.STRING, value: longValue }],
  });
  const model = await parseGGUF(buf, { initialChunkBytes: 64 });
  assert.equal(model.metadata[0].value, longValue);
});

test('parseGGUF: does not read tensor data into memory while parsing', async () => {
  const tensorData = fillPattern(4 * 1024 * 1024, 42); // 4 MiB of "tensor data"
  const tensorInfos = [{ name: 'big', dims: [1024n * 1024n], type: GGMLType.F32, offset: 0n }];
  const raw = buildRawGGUF({ tensorInfos, tensorData });

  const sliceCalls = [];
  const realBlob = new Blob([raw]);
  const spyBlob = {
    size: realBlob.size,
    slice(start, end) {
      sliceCalls.push([start, end]);
      return realBlob.slice(start, end);
    },
  };

  // Force a small initial read window (well under the 4 MiB tensor data) so this
  // test stays meaningful regardless of the production default chunk size.
  const model = await parseGGUF(spyBlob, { initialChunkBytes: 4096 });
  assert.equal(model.tensors[0].length, BigInt(tensorData.length));
  // Every slice requested while parsing must stay within the small header region.
  for (const [, end] of sliceCalls) {
    assert.ok(end <= 4096, `expected header-only reads, but a slice extended to byte ${end}`);
  }
});
