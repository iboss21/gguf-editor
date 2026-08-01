// Encodes/decodes a single GGUF metadata value (scalar or array) to/from
// the binary format. Shared by the parser and serializer so the mapping
// between GGUFValueType and JS representation only lives in one place.
//
// JS representation used for each GGUFValueType:
//   UINT8/INT8/UINT16/INT16/UINT32/INT32/FLOAT32/FLOAT64 -> number
//   UINT64/INT64                                          -> bigint
//   BOOL                                                   -> boolean
//   STRING                                                  -> string
//   ARRAY                                                   -> { itemType, items: [...] }

import { GGUFValueType } from './constants.mjs';

export function readValue(reader, type) {
  switch (type) {
    case GGUFValueType.UINT8:
      return reader.readUint8();
    case GGUFValueType.INT8:
      return reader.readInt8();
    case GGUFValueType.UINT16:
      return reader.readUint16();
    case GGUFValueType.INT16:
      return reader.readInt16();
    case GGUFValueType.UINT32:
      return reader.readUint32();
    case GGUFValueType.INT32:
      return reader.readInt32();
    case GGUFValueType.FLOAT32:
      return reader.readFloat32();
    case GGUFValueType.FLOAT64:
      return reader.readFloat64();
    case GGUFValueType.UINT64:
      return reader.readUint64();
    case GGUFValueType.INT64:
      return reader.readInt64();
    case GGUFValueType.BOOL:
      return reader.readBool();
    case GGUFValueType.STRING:
      return reader.readString();
    case GGUFValueType.ARRAY: {
      const itemType = reader.readUint32();
      const count = reader.readUint64();
      if (count > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new RangeError(`Array length ${count} is too large to handle`);
      }
      const n = Number(count);
      const items = new Array(n);
      for (let i = 0; i < n; i++) {
        items[i] = readValue(reader, itemType);
      }
      return { itemType, items };
    }
    default:
      throw new Error(`Unknown GGUF value type: ${type}`);
  }
}

export function writeValue(writer, type, value) {
  switch (type) {
    case GGUFValueType.UINT8:
      return writer.writeUint8(value);
    case GGUFValueType.INT8:
      return writer.writeInt8(value);
    case GGUFValueType.UINT16:
      return writer.writeUint16(value);
    case GGUFValueType.INT16:
      return writer.writeInt16(value);
    case GGUFValueType.UINT32:
      return writer.writeUint32(value);
    case GGUFValueType.INT32:
      return writer.writeInt32(value);
    case GGUFValueType.FLOAT32:
      return writer.writeFloat32(value);
    case GGUFValueType.FLOAT64:
      return writer.writeFloat64(value);
    case GGUFValueType.UINT64:
      return writer.writeUint64(value);
    case GGUFValueType.INT64:
      return writer.writeInt64(value);
    case GGUFValueType.BOOL:
      return writer.writeBool(value);
    case GGUFValueType.STRING:
      return writer.writeString(value);
    case GGUFValueType.ARRAY: {
      const { itemType, items } = value;
      writer.writeUint32(itemType);
      writer.writeUint64(BigInt(items.length));
      for (const item of items) {
        writeValue(writer, itemType, item);
      }
      return undefined;
    }
    default:
      throw new Error(`Unknown GGUF value type: ${type}`);
  }
}
