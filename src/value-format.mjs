// Human-facing formatting and parsing helpers for metadata values. These
// are pure functions (no DOM access) so they're easy to unit test; the
// actual DOM wiring lives in app.mjs.

import { GGUFValueType, GGUFValueTypeNames, GGMLTypeNames, isBigIntValueType } from './gguf/constants.mjs';

const INTEGER_RANGES = {
  [GGUFValueType.UINT8]: [0n, 255n],
  [GGUFValueType.INT8]: [-128n, 127n],
  [GGUFValueType.UINT16]: [0n, 65535n],
  [GGUFValueType.INT16]: [-32768n, 32767n],
  [GGUFValueType.UINT32]: [0n, 4294967295n],
  [GGUFValueType.INT32]: [-2147483648n, 2147483647n],
  [GGUFValueType.UINT64]: [0n, 18446744073709551615n],
  [GGUFValueType.INT64]: [-9223372036854775808n, 9223372036854775807n],
};

/** Human-readable byte size, e.g. `formatBytes(1536)` -> "1.5 KB". */
export function formatBytes(value) {
  let n = typeof value === 'bigint' ? value : BigInt(Math.max(0, Math.trunc(value)));
  if (n < 0n) n = 0n;
  const units = ['bytes', 'KB', 'MB', 'GB', 'TB', 'PB'];
  if (n < 1024n) return `${n} ${n === 1n ? 'byte' : 'bytes'}`;
  let size = Number(n);
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/** Friendly name for a GGUFValueType id, e.g. "STRING". Falls back to the numeric id. */
export function valueTypeName(type) {
  return GGUFValueTypeNames[type] ?? `unknown(${type})`;
}

/** Friendly name for a GGMLType (tensor element type) id, e.g. "Q4_K". */
export function tensorTypeName(type) {
  return GGMLTypeNames[type] ?? `unknown(${type})`;
}

/** Renders a shape array (bigints) as e.g. "4096 x 4096". */
export function formatShape(dims) {
  return dims.length === 0 ? '(scalar)' : dims.map((d) => d.toString()).join(' \u00d7 ');
}

/** Renders any metadata value (scalar or array) as a short display string. */
export function formatValue(type, value) {
  if (type === GGUFValueType.ARRAY) {
    const { itemType, items } = value;
    const preview = items.slice(0, 8).map((it) => formatScalar(itemType, it));
    const suffix = items.length > 8 ? `, \u2026 (${items.length} total)` : '';
    return `[${preview.join(', ')}${suffix}]`;
  }
  return formatScalar(type, value);
}

function formatScalar(type, value) {
  if (type === GGUFValueType.BOOL) return value ? 'true' : 'false';
  if (type === GGUFValueType.STRING) return value;
  return String(value);
}

/** Renders an array value as one-item-per-line text, suitable for a <textarea>. */
export function formatArrayForEditing(value) {
  return value.items.map((it) => formatScalar(value.itemType, it)).join('\n');
}

/** Renders a scalar value as text suitable for a single-line <input>. */
export function formatScalarForEditing(type, value) {
  return formatScalar(type, value);
}

/**
 * Parses raw text from an `<input>`/`<textarea>` back into the typed JS
 * value used internally for the given GGUFValueType. Throws a descriptive
 * `Error` if the input isn't valid for that type.
 */
export function parseScalarInput(type, raw) {
  const text = String(raw).trim();
  switch (type) {
    case GGUFValueType.BOOL: {
      const lower = text.toLowerCase();
      if (['true', '1', 'yes'].includes(lower)) return true;
      if (['false', '0', 'no', ''].includes(lower)) return false;
      throw new Error(`"${raw}" is not a valid boolean (use true/false)`);
    }
    case GGUFValueType.STRING:
      return text;
    case GGUFValueType.FLOAT32:
    case GGUFValueType.FLOAT64: {
      const n = Number(text);
      if (!Number.isFinite(n)) throw new Error(`"${raw}" is not a valid number`);
      return n;
    }
    default: {
      // All remaining types are integers.
      let n;
      try {
        n = BigInt(text === '' ? '0' : text);
      } catch {
        throw new Error(`"${raw}" is not a valid integer`);
      }
      const range = INTEGER_RANGES[type];
      if (range && (n < range[0] || n > range[1])) {
        throw new Error(`${n} is out of range for ${valueTypeName(type)} (${range[0]}..${range[1]})`);
      }
      return isBigIntValueType(type) ? n : Number(n);
    }
  }
}

/** Parses newline/comma-separated text into an ARRAY value `{ itemType, items }`. */
export function parseArrayInput(itemType, raw) {
  const items = String(raw)
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => parseScalarInput(itemType, s));
  return { itemType, items };
}
