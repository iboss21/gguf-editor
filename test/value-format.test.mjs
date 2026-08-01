import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes,
  valueTypeName,
  tensorTypeName,
  formatShape,
  formatValue,
  parseScalarInput,
  parseArrayInput,
  formatArrayForEditing,
} from '../src/value-format.mjs';
import { GGUFValueType, GGMLType } from '../src/gguf/constants.mjs';

test('formatBytes renders human-friendly sizes', () => {
  assert.equal(formatBytes(0), '0 bytes');
  assert.equal(formatBytes(1), '1 byte');
  assert.equal(formatBytes(512), '512 bytes');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(1024 * 1024), '1.0 MB');
  assert.equal(formatBytes(3n * 1024n * 1024n * 1024n), '3.0 GB');
});

test('valueTypeName / tensorTypeName map known ids and fall back gracefully', () => {
  assert.equal(valueTypeName(GGUFValueType.STRING), 'STRING');
  assert.equal(valueTypeName(9999), 'unknown(9999)');
  assert.equal(tensorTypeName(GGMLType.Q4_K), 'Q4_K');
  assert.equal(tensorTypeName(9999), 'unknown(9999)');
});

test('formatShape renders dimensions and scalars', () => {
  assert.equal(formatShape([4096n, 4096n]), '4096 \u00d7 4096');
  assert.equal(formatShape([]), '(scalar)');
});

test('formatValue renders scalars and truncates long arrays', () => {
  assert.equal(formatValue(GGUFValueType.BOOL, true), 'true');
  assert.equal(formatValue(GGUFValueType.STRING, 'hi'), 'hi');
  const arr = { itemType: GGUFValueType.UINT32, items: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
  assert.equal(formatValue(GGUFValueType.ARRAY, arr), '[1, 2, 3, 4, 5, 6, 7, 8, \u2026 (10 total)]');
});

test('parseScalarInput: integer bounds are enforced', () => {
  assert.equal(parseScalarInput(GGUFValueType.UINT8, '255'), 255);
  assert.throws(() => parseScalarInput(GGUFValueType.UINT8, '256'), /out of range/);
  assert.throws(() => parseScalarInput(GGUFValueType.INT8, '-129'), /out of range/);
  assert.equal(parseScalarInput(GGUFValueType.UINT64, '18446744073709551615'), 18446744073709551615n);
});

test('parseScalarInput: floats, bools, and strings', () => {
  assert.equal(parseScalarInput(GGUFValueType.FLOAT32, '3.5'), 3.5);
  assert.throws(() => parseScalarInput(GGUFValueType.FLOAT32, 'abc'), /not a valid number/);
  assert.equal(parseScalarInput(GGUFValueType.BOOL, 'true'), true);
  assert.equal(parseScalarInput(GGUFValueType.BOOL, 'no'), false);
  assert.throws(() => parseScalarInput(GGUFValueType.BOOL, 'maybe'), /not a valid boolean/);
  assert.equal(parseScalarInput(GGUFValueType.STRING, '  spaced  '), 'spaced');
});

test('parseScalarInput: rejects non-integer text for integer types', () => {
  assert.throws(() => parseScalarInput(GGUFValueType.INT32, '3.5'), /not a valid integer/);
  assert.throws(() => parseScalarInput(GGUFValueType.INT32, 'abc'), /not a valid integer/);
});

test('parseArrayInput / formatArrayForEditing round-trip', () => {
  const parsed = parseArrayInput(GGUFValueType.UINT32, '1\n2, 3\n4');
  assert.deepEqual(parsed, { itemType: GGUFValueType.UINT32, items: [1, 2, 3, 4] });
  assert.equal(formatArrayForEditing(parsed), '1\n2\n3\n4');
});

test('parseArrayInput ignores blank lines', () => {
  const parsed = parseArrayInput(GGUFValueType.STRING, 'a\n\nb\n');
  assert.deepEqual(parsed.items, ['a', 'b']);
});
