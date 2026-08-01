/**
 * Client-side mirror of the backend's in-memory draft helpers
 * (`app/core/gguf_handler.py`: `merge_edits` / `apply_edits_in_memory`).
 *
 * Keeping the same logic here lets the editor show a live preview of pending
 * changes without a round-trip per keystroke. The backend remains the source
 * of truth: the same edit list is replayed server-side when the user saves.
 */
import {
  FLOAT_VALUE_TYPES,
  INT_VALUE_TYPES,
  type MetadataEdit,
  type MetadataItem,
} from "./types";

/** Guess a GGUF value type from a plain JS value (mirrors `infer_value_type`). */
export function inferValueType(value: unknown): [string, string | null] {
  if (typeof value === "boolean") return ["BOOL", null];
  if (typeof value === "number") {
    return Number.isInteger(value) ? ["INT32", null] : ["FLOAT32", null];
  }
  if (typeof value === "string") return ["STRING", null];
  if (Array.isArray(value)) {
    const [sub] = value.length ? inferValueType(value[0]) : ["STRING", null];
    return ["ARRAY", sub];
  }
  return ["STRING", null];
}

/** Merge two ordered edit lists, keeping the latest edit per key. */
export function mergeEdits(
  existing: MetadataEdit[],
  incoming: MetadataEdit[],
): MetadataEdit[] {
  const merged = new Map<string, MetadataEdit>();
  const order: string[] = [];

  for (const edit of [...existing, ...incoming]) {
    if (!merged.has(edit.key)) order.push(edit.key);
    merged.set(edit.key, edit);
  }

  return order.map((key) => merged.get(key)!);
}

/** Compute the effective metadata list after applying `edits` in memory. */
export function applyEditsInMemory(
  metadata: MetadataItem[],
  edits: MetadataEdit[],
): MetadataItem[] {
  const items = new Map<string, MetadataItem>(metadata.map((m) => [m.key, m]));
  const order = metadata.map((m) => m.key);

  for (const edit of edits) {
    if (edit.op === "delete") {
      items.delete(edit.key);
      const index = order.indexOf(edit.key);
      if (index !== -1) order.splice(index, 1);
    } else if (edit.op === "rename") {
      const existing = items.get(edit.key);
      items.delete(edit.key);
      if (existing && edit.new_key) {
        items.set(edit.new_key, { ...existing, key: edit.new_key, modified: true });
        const index = order.indexOf(edit.key);
        if (index !== -1) order[index] = edit.new_key;
      }
    } else {
      const prior = items.get(edit.key);
      const valueType =
        edit.value_type ?? prior?.value_type ?? inferValueType(edit.value)[0];
      let arrayValueType = edit.array_value_type ?? prior?.array_value_type ?? null;
      const isArray = valueType === "ARRAY";
      if (isArray && !arrayValueType) {
        arrayValueType = inferValueType(edit.value)[1];
      }
      items.set(edit.key, {
        key: edit.key,
        value: edit.value,
        value_type: valueType,
        array_value_type: arrayValueType,
        is_array: isArray,
        array_length: isArray && Array.isArray(edit.value) ? edit.value.length : null,
        truncated: false,
        editable: true,
        modified: true,
      });
      if (!order.includes(edit.key)) order.push(edit.key);
    }
  }

  return order.filter((key) => items.has(key)).map((key) => items.get(key)!);
}

/**
 * Parse the text typed into a value input back into the JSON type the
 * backend expects for `value_type`. Returns `null` when the text is not a
 * valid value for that type, so the caller can keep the edit un-staged.
 */
export function parseValue(text: string, valueType: string): unknown | null {
  if (valueType === "BOOL") {
    const normalized = text.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
    return null;
  }
  if (INT_VALUE_TYPES.has(valueType)) {
    const parsed = Number(text.trim());
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) return null;
    return parsed;
  }
  if (FLOAT_VALUE_TYPES.has(valueType)) {
    const parsed = Number(text.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return text;
}

/** Human-readable one-line summary of a staged edit. */
export function describeEdit(edit: MetadataEdit): string {
  switch (edit.op) {
    case "delete":
      return `delete ${edit.key}`;
    case "rename":
      return `rename ${edit.key} → ${edit.new_key ?? "?"}`;
    default: {
      const value =
        typeof edit.value === "string" ? `"${edit.value}"` : String(edit.value);
      return `${edit.key} = ${value}`;
    }
  }
}
