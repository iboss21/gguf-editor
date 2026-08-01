// Helpers for computing tensor byte sizes and alignment padding.
// All arithmetic is done in BigInt because tensor element counts and
// byte offsets can exceed Number.MAX_SAFE_INTEGER for very large models.

import { GGML_QUANT_SIZES, GGMLTypeNames } from './constants.mjs';

/** Rounds `value` up to the next multiple of `alignment` (BigInt-safe). */
export function alignUp(value, alignment) {
  const v = BigInt(value);
  const a = BigInt(alignment);
  if (a <= 0n) return v;
  const rem = v % a;
  return rem === 0n ? v : v + (a - rem);
}

/**
 * Computes the raw byte length of a tensor's data blob from its shape and
 * GGML element type, mirroring `ggml_row_size()`/`ggml_nbytes()`.
 *
 * @param {bigint[]} dims element counts per dimension (as stored in the file)
 * @param {number} type GGMLType id
 * @returns {bigint}
 */
export function computeTensorByteLength(dims, type) {
  const sizes = GGML_QUANT_SIZES[type];
  if (!sizes) {
    const name = GGMLTypeNames[type] ?? `unknown(${type})`;
    throw new Error(`Unsupported tensor type: ${name}`);
  }
  const [blockSize, blockByteSize] = sizes;
  let numElements = 1n;
  for (const d of dims) numElements *= BigInt(d);
  if (numElements === 0n) return 0n;
  const block = BigInt(blockSize);
  if (numElements % block !== 0n) {
    throw new Error(
      `Tensor element count ${numElements} is not a multiple of the block size ${blockSize} for type ${
        GGMLTypeNames[type] ?? type
      }`,
    );
  }
  return (numElements / block) * BigInt(blockByteSize);
}
