// Normalizes the various inputs the parser/serializer accept into a
// Blob-like object with `.size` and `.slice(start, end)`. This lets the
// same code work with a browser `File`/`Blob` (drag & drop, <input type=file>)
// as well as a plain `ArrayBuffer`/`Uint8Array`/Node `Blob` used in tests,
// without ever reading the whole file into memory up front.

function isBlobLike(source) {
  return (
    source !== null &&
    typeof source === 'object' &&
    typeof source.size === 'number' &&
    typeof source.slice === 'function'
  );
}

/**
 * @param {Blob|ArrayBuffer|Uint8Array} source
 * @returns {Blob} a Blob, or a duck-typed object with the same `.size`/`.slice()` shape
 */
export function toBlob(source) {
  if (isBlobLike(source)) {
    return source;
  }
  if (source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    return new Blob([source]);
  }
  throw new TypeError('Expected a Blob, File, ArrayBuffer, or Uint8Array');
}
