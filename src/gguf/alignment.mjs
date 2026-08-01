// Resolves the effective tensor-data alignment for a GGUF file from its
// metadata. Shared by the parser and serializer so both always agree on
// what `general.alignment` currently means, even after the metadata has
// been edited in memory.

import { GGUF_DEFAULT_ALIGNMENT, ALIGNMENT_KEY } from './constants.mjs';

/**
 * @param {Array<{key:string,type:number,value:*}>} metadata
 * @returns {number}
 */
export function getAlignment(metadata) {
  const entry = metadata.find((m) => m.key === ALIGNMENT_KEY);
  if (!entry) return GGUF_DEFAULT_ALIGNMENT;
  const value = Number(entry.value);
  if (!Number.isFinite(value) || value <= 0) return GGUF_DEFAULT_ALIGNMENT;
  return value;
}
