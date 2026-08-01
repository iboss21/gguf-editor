import test from 'node:test';
import assert from 'node:assert/strict';
import { alignUp, computeTensorByteLength } from '../src/gguf/tensor-size.mjs';
import { GGMLType } from '../src/gguf/constants.mjs';

test('alignUp rounds up to the next multiple, and is a no-op when already aligned', () => {
  assert.equal(alignUp(0, 32), 0n);
  assert.equal(alignUp(1, 32), 32n);
  assert.equal(alignUp(32, 32), 32n);
  assert.equal(alignUp(33, 32), 64n);
  assert.equal(alignUp(100, 1), 100n);
});

test('alignUp works with BigInt-scale values', () => {
  const big = 10_000_000_000n;
  assert.equal(alignUp(big + 1n, 32), big + 32n);
});

test('computeTensorByteLength: F32 tensor', () => {
  // 4 x 8 = 32 elements, 4 bytes each (block size 1)
  assert.equal(computeTensorByteLength([4n, 8n], GGMLType.F32), 128n);
});

test('computeTensorByteLength: F16 tensor', () => {
  assert.equal(computeTensorByteLength([10n], GGMLType.F16), 20n);
});

test('computeTensorByteLength: quantized Q4_0 tensor (block size 32)', () => {
  // one block of 32 elements -> 18 bytes
  assert.equal(computeTensorByteLength([32n], GGMLType.Q4_0), 18n);
  // 256 elements = 8 blocks -> 144 bytes
  assert.equal(computeTensorByteLength([256n], GGMLType.Q4_0), 144n);
});

test('computeTensorByteLength: K-quant Q4_K tensor (block size 256)', () => {
  assert.equal(computeTensorByteLength([256n], GGMLType.Q4_K), 144n);
  assert.equal(computeTensorByteLength([1024n], GGMLType.Q4_K), 576n);
});

test('computeTensorByteLength: multi-dimensional tensor multiplies all dims', () => {
  // 4096 x 4096 F16 tensor
  assert.equal(computeTensorByteLength([4096n, 4096n], GGMLType.F16), BigInt(4096 * 4096 * 2));
});

test('computeTensorByteLength: zero-element tensor is zero bytes', () => {
  assert.equal(computeTensorByteLength([0n], GGMLType.F32), 0n);
});

test('computeTensorByteLength: throws on element count not divisible by block size', () => {
  assert.throws(() => computeTensorByteLength([10n], GGMLType.Q4_0), /not a multiple of the block size/);
});

test('computeTensorByteLength: throws on unknown tensor type', () => {
  assert.throws(() => computeTensorByteLength([1n], 9999), /Unsupported tensor type/);
});
