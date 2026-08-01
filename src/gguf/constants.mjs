// GGUF format constants.
//
// GGUF is the binary model file format used by llama.cpp and compatible
// inference runtimes. This module contains the numeric constants and
// lookup tables needed to parse and write GGUF files. It has no
// dependency on the rest of the app and can be reused from Node or the
// browser.
//
// Spec reference: https://github.com/ggml-org/ggml/blob/master/docs/gguf.md

/** Magic bytes at the very start of every GGUF file, spelling "GGUF". */
export const GGUF_MAGIC = 0x46554747;

/** ASCII bytes of the magic string, useful for quick byte-for-byte checks. */
export const GGUF_MAGIC_BYTES = [0x47, 0x47, 0x55, 0x46]; // 'G','G','U','F'

/** GGUF versions this library knows how to read and write. */
export const SUPPORTED_VERSIONS = [2, 3];

/** Default tensor data alignment (bytes) used when `general.alignment` is absent. */
export const GGUF_DEFAULT_ALIGNMENT = 32;

/** Well-known metadata key that overrides the default tensor data alignment. */
export const ALIGNMENT_KEY = 'general.alignment';

/** Value type tags used for every metadata key/value pair. */
export const GGUFValueType = Object.freeze({
  UINT8: 0,
  INT8: 1,
  UINT16: 2,
  INT16: 3,
  UINT32: 4,
  INT32: 5,
  FLOAT32: 6,
  BOOL: 7,
  STRING: 8,
  ARRAY: 9,
  UINT64: 10,
  INT64: 11,
  FLOAT64: 12,
});

/** Reverse lookup: numeric type tag -> readable name. */
export const GGUFValueTypeNames = Object.freeze(
  Object.fromEntries(Object.entries(GGUFValueType).map(([name, id]) => [id, name])),
);

/** True for value types whose JS representation is a BigInt (64-bit integers). */
export function isBigIntValueType(type) {
  return type === GGUFValueType.UINT64 || type === GGUFValueType.INT64;
}

/** Tensor element (quantization) types, as stored in tensor info records. */
export const GGMLType = Object.freeze({
  F32: 0,
  F16: 1,
  Q4_0: 2,
  Q4_1: 3,
  Q5_0: 6,
  Q5_1: 7,
  Q8_0: 8,
  Q8_1: 9,
  Q2_K: 10,
  Q3_K: 11,
  Q4_K: 12,
  Q5_K: 13,
  Q6_K: 14,
  Q8_K: 15,
  IQ2_XXS: 16,
  IQ2_XS: 17,
  IQ3_XXS: 18,
  IQ1_S: 19,
  IQ4_NL: 20,
  IQ3_S: 21,
  IQ2_S: 22,
  IQ4_XS: 23,
  I8: 24,
  I16: 25,
  I32: 26,
  I64: 27,
  F64: 28,
  IQ1_M: 29,
  BF16: 30,
  TQ1_0: 34,
  TQ2_0: 35,
  MXFP4: 39,
  NVFP4: 40,
  Q1_0: 41,
});

/** Reverse lookup: numeric tensor type -> readable name. */
export const GGMLTypeNames = Object.freeze(
  Object.fromEntries(Object.entries(GGMLType).map(([name, id]) => [id, name])),
);

/**
 * Per-type `[blockSize, blockByteSize]` used to compute a tensor's raw byte
 * length from its element count: `bytes = (numElements / blockSize) * blockByteSize`.
 * Mirrors GGML_QUANT_SIZES from ggml/llama.cpp (QK_K = 256).
 */
export const GGML_QUANT_SIZES = Object.freeze({
  [GGMLType.F32]: [1, 4],
  [GGMLType.F16]: [1, 2],
  [GGMLType.Q4_0]: [32, 18],
  [GGMLType.Q4_1]: [32, 20],
  [GGMLType.Q5_0]: [32, 22],
  [GGMLType.Q5_1]: [32, 24],
  [GGMLType.Q8_0]: [32, 34],
  [GGMLType.Q8_1]: [32, 40],
  [GGMLType.Q2_K]: [256, 84],
  [GGMLType.Q3_K]: [256, 110],
  [GGMLType.Q4_K]: [256, 144],
  [GGMLType.Q5_K]: [256, 176],
  [GGMLType.Q6_K]: [256, 210],
  [GGMLType.Q8_K]: [256, 292],
  [GGMLType.IQ2_XXS]: [256, 66],
  [GGMLType.IQ2_XS]: [256, 74],
  [GGMLType.IQ3_XXS]: [256, 98],
  [GGMLType.IQ1_S]: [256, 50],
  [GGMLType.IQ4_NL]: [32, 18],
  [GGMLType.IQ3_S]: [256, 110],
  [GGMLType.IQ2_S]: [256, 82],
  [GGMLType.IQ4_XS]: [256, 136],
  [GGMLType.I8]: [1, 1],
  [GGMLType.I16]: [1, 2],
  [GGMLType.I32]: [1, 4],
  [GGMLType.I64]: [1, 8],
  [GGMLType.F64]: [1, 8],
  [GGMLType.IQ1_M]: [256, 56],
  [GGMLType.BF16]: [1, 2],
  [GGMLType.TQ1_0]: [256, 54],
  [GGMLType.TQ2_0]: [256, 66],
  [GGMLType.MXFP4]: [32, 17],
  [GGMLType.NVFP4]: [64, 36],
  [GGMLType.Q1_0]: [128, 18],
});

/** A short list of well-known metadata keys, used to power UI autocomplete. */
export const WELL_KNOWN_KEYS = Object.freeze([
  'general.type',
  'general.architecture',
  'general.quantization_version',
  'general.alignment',
  'general.file_type',
  'general.name',
  'general.author',
  'general.version',
  'general.organization',
  'general.finetune',
  'general.basename',
  'general.description',
  'general.quantized_by',
  'general.size_label',
  'general.license',
  'general.license.name',
  'general.license.link',
  'general.url',
  'general.doi',
  'general.uuid',
  'general.repo_url',
  'general.source.url',
  'general.source.doi',
  'general.source.uuid',
  'general.source.repo_url',
  'general.tags',
  'general.languages',
  'general.datasets',
]);
