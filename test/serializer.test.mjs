import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { parseGGUF } from '../src/gguf/parser.mjs';
import { exportGGUF } from '../src/gguf/serializer.mjs';
import { GGUFValueType, GGMLType } from '../src/gguf/constants.mjs';
import { buildRawGGUF, fillPattern } from './fixtures.mjs';

async function blobBytes(blob) {
  return new Uint8Array(await blob.arrayBuffer());
}

test('round-trip: exporting without any edits preserves metadata and tensor bytes exactly', async () => {
  const tensorInfos = [
    { name: 'weight.a', dims: [4n, 4n], type: GGMLType.F32, offset: 0n },
    { name: 'weight.b', dims: [64n], type: GGMLType.Q4_0, offset: 64n },
  ];
  const tensorData = Buffer.concat([fillPattern(64, 7), fillPattern(36, 8)]);
  const raw = buildRawGGUF({
    metadata: [
      { key: 'general.architecture', type: GGUFValueType.STRING, value: 'llama' },
      { key: 'general.name', type: GGUFValueType.STRING, value: 'test-model' },
    ],
    tensorInfos,
    tensorData,
  });

  const model = await parseGGUF(raw);
  const exported = exportGGUF(model);
  const reparsed = await parseGGUF(exported);

  assert.deepEqual(reparsed.metadata, model.metadata);
  assert.equal(reparsed.tensors.length, 2);
  for (let i = 0; i < reparsed.tensors.length; i++) {
    assert.equal(reparsed.tensors[i].name, model.tensors[i].name);
    assert.equal(reparsed.tensors[i].length, model.tensors[i].length);
  }

  // Tensor bytes must be byte-for-byte identical to the original.
  for (let i = 0; i < reparsed.tensors.length; i++) {
    const orig = await blobBytes(
      model.blob.slice(Number(model.tensors[i].fileOffset), Number(model.tensors[i].fileOffset + model.tensors[i].length)),
    );
    const out = await blobBytes(
      reparsed.blob.slice(
        Number(reparsed.tensors[i].fileOffset),
        Number(reparsed.tensors[i].fileOffset + reparsed.tensors[i].length),
      ),
    );
    assert.deepEqual(Array.from(out), Array.from(orig));
  }
});

test('round-trip: editing a metadata value is reflected after export + re-parse', async () => {
  const raw = buildRawGGUF({
    metadata: [{ key: 'general.name', type: GGUFValueType.STRING, value: 'old-name' }],
  });
  const model = await parseGGUF(raw);
  model.metadata[0].value = 'new-name';

  const reparsed = await parseGGUF(exportGGUF(model));
  assert.equal(reparsed.metadata[0].value, 'new-name');
});

test('round-trip: adding and removing metadata entries', async () => {
  const raw = buildRawGGUF({
    metadata: [
      { key: 'keep.me', type: GGUFValueType.UINT32, value: 1 },
      { key: 'remove.me', type: GGUFValueType.UINT32, value: 2 },
    ],
  });
  const model = await parseGGUF(raw);
  model.metadata = model.metadata.filter((m) => m.key !== 'remove.me');
  model.metadata.push({ key: 'added.key', type: GGUFValueType.BOOL, value: true });

  const reparsed = await parseGGUF(exportGGUF(model));
  const keys = reparsed.metadata.map((m) => m.key);
  assert.deepEqual(keys, ['keep.me', 'added.key']);
  assert.equal(reparsed.metadata[1].value, true);
});

test('round-trip: renaming a tensor preserves its data', async () => {
  const tensorInfos = [{ name: 'old.tensor.name', dims: [8n], type: GGMLType.F32, offset: 0n }];
  const tensorData = fillPattern(32, 3);
  const raw = buildRawGGUF({ tensorInfos, tensorData });

  const model = await parseGGUF(raw);
  model.tensors[0].name = 'new.tensor.name';

  const reparsed = await parseGGUF(exportGGUF(model));
  assert.equal(reparsed.tensors[0].name, 'new.tensor.name');
  const bytes = await blobBytes(
    reparsed.blob.slice(Number(reparsed.tensors[0].fileOffset), Number(reparsed.tensors[0].fileOffset + reparsed.tensors[0].length)),
  );
  assert.deepEqual(Array.from(bytes), Array.from(fillPattern(32, 3)));
});

test('round-trip: changing alignment recomputes tensor offsets without corrupting data', async () => {
  const tensorInfos = [
    { name: 't1', dims: [8n], type: GGMLType.F32, offset: 0n }, // 32 bytes
    { name: 't2', dims: [8n], type: GGMLType.F32, offset: 32n }, // 32 bytes
  ];
  const tensorData = Buffer.concat([fillPattern(32, 5), fillPattern(32, 6)]);
  const raw = buildRawGGUF({ tensorInfos, tensorData, alignment: 32 });

  const model = await parseGGUF(raw);
  assert.equal(model.alignment, 32);

  // Bump alignment to 128 via the general.alignment metadata key.
  model.metadata.push({ key: 'general.alignment', type: GGUFValueType.UINT32, value: 128 });
  const reparsed = await parseGGUF(exportGGUF(model));

  assert.equal(reparsed.alignment, 128);
  assert.equal(reparsed.dataStart % 128n, 0n);
  assert.equal(reparsed.tensors[1].fileOffset % 128n, 0n);

  const t1Bytes = await blobBytes(
    reparsed.blob.slice(Number(reparsed.tensors[0].fileOffset), Number(reparsed.tensors[0].fileOffset + reparsed.tensors[0].length)),
  );
  const t2Bytes = await blobBytes(
    reparsed.blob.slice(Number(reparsed.tensors[1].fileOffset), Number(reparsed.tensors[1].fileOffset + reparsed.tensors[1].length)),
  );
  assert.deepEqual(Array.from(t1Bytes), Array.from(fillPattern(32, 5)));
  assert.deepEqual(Array.from(t2Bytes), Array.from(fillPattern(32, 6)));
});

test('round-trip: array metadata (numbers and strings) survives export', async () => {
  const raw = buildRawGGUF({
    metadata: [
      {
        key: 'tokenizer.ggml.tokens',
        type: GGUFValueType.ARRAY,
        value: { itemType: GGUFValueType.STRING, items: ['<s>', '</s>', 'hello', 'wörld 🌍'] },
      },
      {
        key: 'some.scores',
        type: GGUFValueType.ARRAY,
        value: { itemType: GGUFValueType.FLOAT32, items: [0.1, 0.2, 0.3] },
      },
    ],
  });
  const model = await parseGGUF(raw);
  const reparsed = await parseGGUF(exportGGUF(model));
  assert.deepEqual(reparsed.metadata[0].value.items, ['<s>', '</s>', 'hello', 'wörld 🌍']);
  const scores = reparsed.metadata[1].value.items;
  for (let i = 0; i < scores.length; i++) {
    assert.ok(Math.abs(scores[i] - [0.1, 0.2, 0.3][i]) < 1e-6);
  }
});

test('round-trip: exporting a model with zero tensors produces a valid file', async () => {
  const raw = buildRawGGUF({ metadata: [{ key: 'general.name', type: GGUFValueType.STRING, value: 'empty' }] });
  const model = await parseGGUF(raw);
  const reparsed = await parseGGUF(exportGGUF(model));
  assert.deepEqual(reparsed.tensors, []);
  assert.equal(reparsed.metadata[0].value, 'empty');
});

test('round-trip: large tensor data (multiple MB) is preserved byte-for-byte', async () => {
  const size = 3 * 1024 * 1024; // 3 MiB, divisible by 4 for F32
  const tensorInfos = [{ name: 'big', dims: [BigInt(size / 4)], type: GGMLType.F32, offset: 0n }];
  const tensorData = fillPattern(size, 99);
  const raw = buildRawGGUF({ tensorInfos, tensorData });

  const model = await parseGGUF(raw, { initialChunkBytes: 4096 });
  model.metadata.push({ key: 'general.name', type: GGUFValueType.STRING, value: 'big-model' });
  const exported = exportGGUF(model);
  const reparsed = await parseGGUF(exported, { initialChunkBytes: 4096 });

  const outBytes = await blobBytes(
    reparsed.blob.slice(Number(reparsed.tensors[0].fileOffset), Number(reparsed.tensors[0].fileOffset + reparsed.tensors[0].length)),
  );
  assert.deepEqual(Array.from(outBytes), Array.from(tensorData));
});
