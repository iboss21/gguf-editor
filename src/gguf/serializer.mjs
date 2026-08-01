// Rebuilds a GGUF file after metadata edits.
//
// Tensor *data* is never read into memory or modified: each tensor's
// bytes are referenced via a zero-copy `Blob#slice()` on the original
// file and reassembled, in order, into a new `Blob`. Only the (small)
// header, metadata, and tensor-info sections are actually rebuilt from
// scratch, so this works efficiently even for many-gigabyte models.

import { GGUF_MAGIC_BYTES } from './constants.mjs';
import { ByteWriter } from './byte-writer.mjs';
import { writeValue } from './value-codec.mjs';
import { alignUp } from './tensor-size.mjs';
import { getAlignment } from './alignment.mjs';

/**
 * Builds the header + metadata + tensor-info bytes for `model`, recomputing
 * each tensor's offset (in its current order) from the current alignment.
 * The alignment is always re-derived from `model.metadata`'s current
 * `general.alignment` entry (if any), not from `model.alignment`, so this
 * stays correct even if that entry was just added, changed, or removed.
 *
 * @param {import('./parser.mjs').GGUFModel} model
 * @returns {{ headerBytes: Uint8Array, alignment: number, layout: Array<{name:string, length:bigint, sourceOffset:bigint, newOffset:bigint, paddingAfter:number}> }}
 */
export function buildHeaderBytes(model) {
  const alignment = getAlignment(model.metadata);
  const writer = new ByteWriter();
  writer.writeBytes(Uint8Array.from(GGUF_MAGIC_BYTES));
  writer.writeUint32(model.version);
  writer.writeUint64(BigInt(model.tensors.length));
  writer.writeUint64(BigInt(model.metadata.length));

  for (const { key, type, value } of model.metadata) {
    writer.writeString(key);
    writer.writeUint32(type);
    writeValue(writer, type, value);
  }

  // Recompute tensor offsets fresh (in the model's current tensor order),
  // since editing metadata can change the alignment and therefore shift
  // every offset even though tensor data itself is untouched.
  let running = 0n;
  const layout = model.tensors.map((t) => {
    const newOffset = running;
    const alignedEnd = alignUp(newOffset + t.length, alignment);
    const paddingAfter = Number(alignedEnd - (newOffset + t.length));
    running = alignedEnd;
    return { name: t.name, length: t.length, sourceOffset: t.fileOffset, newOffset, paddingAfter };
  });

  for (let i = 0; i < model.tensors.length; i++) {
    const t = model.tensors[i];
    writer.writeString(t.name);
    writer.writeUint32(t.dims.length);
    for (const d of t.dims) writer.writeUint64(d);
    writer.writeUint32(t.type);
    writer.writeUint64(layout[i].newOffset);
  }

  const headerBytes = writer.toUint8Array();
  return { headerBytes, alignment, layout };
}

/**
 * Rebuilds the full GGUF file as a `Blob`, ready to be downloaded or
 * further inspected. Tensor bytes are copied from `model.blob` lazily via
 * `Blob#slice()`, so no tensor data is loaded into JS memory here.
 *
 * @param {import('./parser.mjs').GGUFModel} model
 * @returns {Blob}
 */
export function exportGGUF(model) {
  const { headerBytes, alignment, layout } = buildHeaderBytes(model);
  const alignedHeaderEnd = alignUp(headerBytes.length, alignment);
  const headerPadding = Number(alignedHeaderEnd - BigInt(headerBytes.length));

  const parts = [headerBytes];
  if (headerPadding > 0) parts.push(new Uint8Array(headerPadding));

  for (const t of layout) {
    if (t.length > 0n) {
      const start = Number(t.sourceOffset);
      const end = Number(t.sourceOffset + t.length);
      parts.push(model.blob.slice(start, end));
    }
    if (t.paddingAfter > 0) parts.push(new Uint8Array(t.paddingAfter));
  }

  return new Blob(parts, { type: 'application/octet-stream' });
}

