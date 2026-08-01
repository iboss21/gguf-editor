// Parses a GGUF file's header, metadata, and tensor info.
//
// Design goal: never read the (potentially huge, many-GB) tensor data
// section into memory. Only the small leading part of the file - the
// fixed header, metadata key/value pairs, and tensor info table - is
// read eagerly. Tensor *data* is left as a lazy `{ fileOffset, length }`
// reference into the original Blob/File, resolved on demand (e.g. when
// exporting).

import { GGUF_MAGIC_BYTES, SUPPORTED_VERSIONS } from './constants.mjs';
import { ByteReader, BufferUnderrunError } from './byte-reader.mjs';
import { readValue } from './value-codec.mjs';
import { alignUp, computeTensorByteLength } from './tensor-size.mjs';
import { getAlignment } from './alignment.mjs';
import { toBlob } from './blob-source.mjs';

export { BufferUnderrunError };

/** Raised when the input is not a well-formed (or is a truncated/corrupt) GGUF file. */
export class GGUFParseError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GGUFParseError';
  }
}

function magicMatches(bytes) {
  return GGUF_MAGIC_BYTES.every((b, i) => bytes[i] === b);
}

/** Parses the fixed header + metadata + tensor-info from an in-memory buffer. */
function parseHeaderChunk(buf) {
  const reader = new ByteReader(buf);
  const magic = reader.readBytes(4);
  if (!magicMatches(magic)) {
    throw new GGUFParseError('Not a valid GGUF file: missing "GGUF" magic number');
  }

  const version = reader.readUint32();
  if (!SUPPORTED_VERSIONS.includes(version)) {
    throw new GGUFParseError(
      `Unsupported GGUF version ${version} (supported versions: ${SUPPORTED_VERSIONS.join(', ')})`,
    );
  }

  const tensorCountRaw = reader.readUint64();
  const kvCountRaw = reader.readUint64();
  if (tensorCountRaw > BigInt(Number.MAX_SAFE_INTEGER) || kvCountRaw > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new GGUFParseError('File reports an implausibly large tensor or metadata count');
  }
  const tensorCount = Number(tensorCountRaw);
  const kvCount = Number(kvCountRaw);

  const metadata = [];
  for (let i = 0; i < kvCount; i++) {
    const key = reader.readString();
    const type = reader.readUint32();
    const value = readValue(reader, type);
    metadata.push({ key, type, value });
  }

  const tensorInfos = [];
  for (let i = 0; i < tensorCount; i++) {
    const name = reader.readString();
    const nDims = reader.readUint32();
    const dims = [];
    for (let d = 0; d < nDims; d++) dims.push(reader.readUint64());
    const type = reader.readUint32();
    const offset = reader.readUint64();
    tensorInfos.push({ name, dims, type, offset });
  }

  return { version, metadata, tensorInfos, headerEndOffset: reader.offset };
}

/**
 * Parses a GGUF file's header, metadata, and tensor info.
 *
 * @param {Blob|File|ArrayBuffer|Uint8Array} source
 * @param {{ initialChunkBytes?: number, maxHeaderBytes?: number }} [options]
 * @returns {Promise<GGUFModel>}
 *
 * @typedef {object} GGUFTensor
 * @property {string} name
 * @property {number} type GGMLType id
 * @property {bigint[]} dims
 * @property {bigint} length raw byte length of this tensor's data
 * @property {bigint} fileOffset absolute byte offset of this tensor's data in the source file
 *
 * @typedef {object} GGUFMetadataEntry
 * @property {string} key
 * @property {number} type GGUFValueType id
 * @property {*} value
 *
 * @typedef {object} GGUFModel
 * @property {number} version
 * @property {number} alignment
 * @property {GGUFMetadataEntry[]} metadata
 * @property {GGUFTensor[]} tensors
 * @property {bigint} dataStart absolute offset where the tensor data section begins
 * @property {bigint} fileSize
 * @property {Blob} blob the original file, used to lazily read tensor bytes back out
 */
export async function parseGGUF(source, options = {}) {
  const blob = toBlob(source);
  const fileSize = blob.size;
  if (fileSize < 24) {
    throw new GGUFParseError('File is too small to be a valid GGUF file');
  }

  const maxHeaderBytes = Math.max(1, Math.min(options.maxHeaderBytes ?? 512 * 1024 * 1024, fileSize));
  let chunkSize = Math.max(Math.min(options.initialChunkBytes ?? 8 * 1024 * 1024, fileSize), 24);

  let parsed = null;
  // Grow the read window until the whole metadata/tensor-info section fits,
  // without ever touching the (possibly huge) tensor data that follows it.
  for (;;) {
    const buf = await blob.slice(0, chunkSize).arrayBuffer();
    try {
      parsed = parseHeaderChunk(buf);
      break;
    } catch (err) {
      const canGrow = err instanceof BufferUnderrunError && chunkSize < fileSize;
      if (!canGrow) {
        throw err instanceof BufferUnderrunError
          ? new GGUFParseError('File is truncated or corrupt: metadata/tensor-info section is incomplete')
          : err;
      }
      if (chunkSize >= maxHeaderBytes) {
        throw new GGUFParseError(
          'GGUF metadata/tensor-info section exceeds the safety limit; the file may be corrupt',
        );
      }
      chunkSize = Math.min(chunkSize * 2, fileSize, maxHeaderBytes);
    }
  }

  const { version, metadata, tensorInfos, headerEndOffset } = parsed;
  const alignment = getAlignment(metadata);
  const dataStart = alignUp(headerEndOffset, alignment);
  const fileSizeBig = BigInt(fileSize);

  const tensors = tensorInfos.map((t) => {
    const length = computeTensorByteLength(t.dims, t.type);
    const fileOffset = dataStart + t.offset;
    if (fileOffset + length > fileSizeBig) {
      throw new GGUFParseError(
        `Tensor "${t.name}" data (offset ${fileOffset}, length ${length}) extends past the end of the file; ` +
          'the file appears to be truncated or corrupt',
      );
    }
    return { name: t.name, type: t.type, dims: t.dims, length, fileOffset };
  });

  return { version, alignment, metadata, tensors, dataStart, fileSize: fileSizeBig, blob };
}
