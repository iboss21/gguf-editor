"use client";

import { useMemo, useState } from "react";

import { parseValue } from "@/lib/edits";
import { formatValue } from "@/lib/format";
import type { MetadataEdit, MetadataItem } from "@/lib/types";
import { IconCheck, IconClose, IconTrash, IconUndo, IconWand } from "./ui";

interface MetadataTableProps {
  items: MetadataItem[];
  /** Keys with a staged (unsaved) edit, so rows can be marked. */
  stagedKeys: Set<string>;
  filter: string;
  onStage: (edit: MetadataEdit) => void;
  onRevert: (key: string) => void;
}

export function MetadataTable({
  items,
  stagedKeys,
  filter,
  onStage,
  onRevert,
}: MetadataTableProps) {
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [renamingKey, setRenamingKey] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [invalid, setInvalid] = useState(false);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(
      (item) =>
        item.key.toLowerCase().includes(needle) ||
        formatValue(item.value, item.array_length).toLowerCase().includes(needle),
    );
  }, [items, filter]);

  function beginEdit(item: MetadataItem) {
    if (!item.editable || item.is_array) return;
    setRenamingKey(null);
    setEditingKey(item.key);
    setInvalid(false);
    setDraft(formatValue(item.value));
  }

  function commitEdit(item: MetadataItem) {
    const parsed = parseValue(draft, item.value_type);
    if (parsed === null) {
      setInvalid(true);
      return;
    }
    if (parsed !== item.value) {
      onStage({
        op: "set",
        key: item.key,
        value: parsed,
        value_type: item.value_type,
      });
    }
    setEditingKey(null);
    setInvalid(false);
  }

  function commitRename(item: MetadataItem) {
    const next = renameDraft.trim();
    if (next && next !== item.key) {
      onStage({ op: "rename", key: item.key, new_key: next });
    }
    setRenamingKey(null);
  }

  if (!visible.length) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted">
        {items.length ? "No metadata key matches the filter." : "This file has no metadata."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-line text-left text-xs tracking-wide text-muted uppercase">
            <th className="w-[34%] px-4 py-2 font-medium">Key</th>
            <th className="w-24 px-2 py-2 font-medium">Type</th>
            <th className="px-2 py-2 font-medium">Value</th>
            <th className="w-24 px-4 py-2 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((item) => {
            const staged = stagedKeys.has(item.key) || item.modified;
            const isEditing = editingKey === item.key;
            const isRenaming = renamingKey === item.key;

            return (
              <tr
                key={item.key}
                className={`group border-b border-line/60 align-top transition ${
                  staged ? "bg-accent/8" : "hover:bg-raised/60"
                }`}
              >
                <td className="px-4 py-2">
                  {isRenaming ? (
                    <div className="flex items-center gap-1">
                      <input
                        className="input font-mono text-xs"
                        value={renameDraft}
                        autoFocus
                        onChange={(event) => setRenameDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitRename(item);
                          if (event.key === "Escape") setRenamingKey(null);
                        }}
                      />
                      <button
                        type="button"
                        className="btn-ghost rounded p-1 text-success"
                        onClick={() => commitRename(item)}
                        aria-label="Confirm rename"
                      >
                        <IconCheck className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost rounded p-1"
                        onClick={() => setRenamingKey(null)}
                        aria-label="Cancel rename"
                      >
                        <IconClose className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-xs break-all text-content">
                        {item.key}
                      </span>
                      {staged && (
                        <span className="chip shrink-0 border-accent/50 text-accent">
                          edited
                        </span>
                      )}
                    </div>
                  )}
                </td>

                <td className="px-2 py-2">
                  <span className="font-mono text-[11px] text-muted">
                    {item.is_array
                      ? `${item.array_value_type ?? "?"}[${item.array_length ?? 0}]`
                      : item.value_type}
                  </span>
                </td>

                <td className="px-2 py-2">
                  {isEditing ? (
                    <div className="flex items-center gap-1">
                      <input
                        className={`input font-mono text-xs ${invalid ? "border-danger" : ""}`}
                        value={draft}
                        autoFocus
                        onChange={(event) => {
                          setDraft(event.target.value);
                          setInvalid(false);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") commitEdit(item);
                          if (event.key === "Escape") setEditingKey(null);
                        }}
                      />
                      <button
                        type="button"
                        className="btn-ghost rounded p-1 text-success"
                        onClick={() => commitEdit(item)}
                        aria-label="Confirm value"
                      >
                        <IconCheck className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        className="btn-ghost rounded p-1"
                        onClick={() => setEditingKey(null)}
                        aria-label="Cancel edit"
                      >
                        <IconClose className="size-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => beginEdit(item)}
                      disabled={!item.editable || item.is_array}
                      title={
                        item.editable && !item.is_array
                          ? "Click to edit"
                          : "Large arrays can only be changed through the assistant"
                      }
                      className="w-full rounded px-1 py-0.5 text-left font-mono text-xs break-all whitespace-pre-wrap text-content disabled:cursor-default disabled:text-muted enabled:hover:bg-canvas"
                    >
                      {formatValue(item.value, item.array_length) || (
                        <span className="text-faint">(empty)</span>
                      )}
                    </button>
                  )}
                  {invalid && isEditing && (
                    <p className="mt-1 text-xs text-danger">
                      Not a valid {item.value_type} value.
                    </p>
                  )}
                </td>

                <td className="px-4 py-2">
                  <div className="flex items-center justify-end gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    {staged && (
                      <button
                        type="button"
                        className="btn-ghost rounded p-1 hover:text-content"
                        onClick={() => onRevert(item.key)}
                        title="Discard staged change for this key"
                      >
                        <IconUndo className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-ghost rounded p-1 hover:text-content"
                      onClick={() => {
                        setEditingKey(null);
                        setRenamingKey(item.key);
                        setRenameDraft(item.key);
                      }}
                      title="Rename key"
                    >
                      <IconWand className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="btn-ghost rounded p-1 hover:text-danger"
                      onClick={() => onStage({ op: "delete", key: item.key })}
                      title="Delete key"
                    >
                      <IconTrash className="size-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
