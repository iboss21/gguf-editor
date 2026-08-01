"use client";

import { useEffect, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { describeEdit, parseValue } from "@/lib/edits";
import {
  SCALAR_VALUE_TYPES,
  type ApplyEditsResponse,
  type GGUFFileInfo,
  type MetadataEdit,
  type OutputMode,
  type OutputOptions,
  type ScalarValueType,
} from "@/lib/types";
import { Banner, Field, Modal, Spinner, Toggle } from "./ui";

/* --------------------------------------------------------------------------
   Output options (shared by the save + rebrand dialogs)
   -------------------------------------------------------------------------- */

function OutputOptionsFields({
  value,
  onChange,
  sourceFilename,
}: {
  value: OutputOptions;
  onChange: (next: OutputOptions) => void;
  sourceFilename: string;
}) {
  const suggested = `${sourceFilename.replace(/\.gguf$/i, "")}-edited.gguf`;

  return (
    <>
      <Field label="Output">
        <div className="grid gap-2 sm:grid-cols-2">
          {(
            [
              ["new_name", "Save as a new file", "Keeps the original untouched."],
              ["overwrite", "Overwrite in place", "Writes over the source file."],
            ] as [OutputMode, string, string][]
          ).map(([mode, title, hint]) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChange({ ...value, mode })}
              className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                value.mode === mode
                  ? "border-accent bg-accent/10"
                  : "border-line hover:border-line-strong hover:bg-raised"
              }`}
            >
              <span className="block font-medium">{title}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </button>
          ))}
        </div>
      </Field>

      {value.mode === "new_name" && (
        <Field label="New filename" hint={`Leave blank to use “${suggested}”.`}>
          <input
            className="input font-mono"
            value={value.filename ?? ""}
            placeholder={suggested}
            onChange={(event) =>
              onChange({ ...value, filename: event.target.value || null })
            }
          />
        </Field>
      )}

      <Toggle
        checked={value.backup}
        onChange={(backup) => onChange({ ...value, backup })}
        label="Back up the file being replaced"
        hint="Copies the existing file into the backend's data/backups folder before writing."
      />
    </>
  );
}

function EditSummary({ edits }: { edits: MetadataEdit[] }) {
  if (!edits.length) return null;
  return (
    <div className="mb-4 max-h-48 overflow-y-auto rounded-md border border-line bg-canvas p-2">
      <ul className="space-y-0.5">
        {edits.map((edit, index) => (
          <li
            key={`${edit.op}-${edit.key}-${index}`}
            className="font-mono text-xs break-all text-muted"
          >
            <span
              className={
                edit.op === "delete"
                  ? "text-danger"
                  : edit.op === "rename"
                    ? "text-info"
                    : "text-success"
              }
            >
              {edit.op}
            </span>{" "}
            {describeEdit(edit)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* --------------------------------------------------------------------------
   Save dialog
   -------------------------------------------------------------------------- */

export function SaveDialog({
  open,
  file,
  edits,
  onClose,
  onSaved,
}: {
  open: boolean;
  file: GGUFFileInfo;
  edits: MetadataEdit[];
  onClose: () => void;
  onSaved: (result: ApplyEditsResponse) => void;
}) {
  const [output, setOutput] = useState<OutputOptions>({
    mode: "new_name",
    filename: null,
    backup: true,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setOutput({ mode: "new_name", filename: null, backup: true });
      setError(null);
    }
  }, [open]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.applyEdits(file.root_id, file.rel_path, edits, output);
      onSaved(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Save ${edits.length} change${edits.length === 1 ? "" : "s"}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={busy || !edits.length}
          >
            {busy && <Spinner className="size-3.5" />} Write file
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner onDismiss={() => setError(null)}>{error}</Banner>
        </div>
      )}
      <EditSummary edits={edits} />
      <p className="mb-4 text-sm text-muted">
        Tensor data is streamed across unchanged — only the metadata block is
        rewritten. The new file is written to a temporary file first and swapped
        into place once complete.
      </p>
      <OutputOptionsFields
        value={output}
        onChange={setOutput}
        sourceFilename={file.filename}
      />
    </Modal>
  );
}

/* --------------------------------------------------------------------------
   Rebrand dialog
   -------------------------------------------------------------------------- */

export function RebrandDialog({
  open,
  file,
  onClose,
  onStage,
  onApplied,
}: {
  open: boolean;
  file: GGUFFileInfo;
  onClose: () => void;
  onStage: (edits: MetadataEdit[]) => void;
  onApplied: (result: ApplyEditsResponse) => void;
}) {
  const [find, setFind] = useState("");
  const [replace, setReplace] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [includeFilename, setIncludeFilename] = useState(true);
  const [preview, setPreview] = useState<MetadataEdit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<OutputOptions>({
    mode: "new_name",
    filename: null,
    backup: true,
  });

  useEffect(() => {
    if (open) {
      setFind("");
      setReplace("");
      setPreview(null);
      setError(null);
      setOutput({ mode: "new_name", filename: null, backup: true });
    }
  }, [open]);

  // Debounced preview so the user sees exactly which fields would change.
  useEffect(() => {
    if (!open || !find.trim()) {
      setPreview(null);
      return;
    }
    const handle = setTimeout(async () => {
      try {
        const result = await api.previewRebrand({
          root_id: file.root_id,
          rel_path: file.rel_path,
          find,
          replace,
          case_sensitive: caseSensitive,
        });
        setPreview(result.edits);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : String(err));
      }
    }, 300);
    return () => clearTimeout(handle);
  }, [open, find, replace, caseSensitive, file.root_id, file.rel_path]);

  async function applyNow() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.rebrand({
        root_id: file.root_id,
        rel_path: file.rel_path,
        find,
        replace,
        case_sensitive: caseSensitive,
        include_filename: includeFilename,
        output,
      });
      onApplied(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const hasPreview = !!preview?.length;

  return (
    <Modal
      open={open}
      title="Bulk rebrand"
      onClose={onClose}
      width="max-w-xl"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={!hasPreview}
            onClick={() => {
              onStage(preview!);
              onClose();
            }}
            title="Add these changes to the pending list instead of writing now"
          >
            Stage changes
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || !hasPreview}
            onClick={() => void applyNow()}
          >
            {busy && <Spinner className="size-3.5" />} Apply &amp; write
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner onDismiss={() => setError(null)}>{error}</Banner>
        </div>
      )}

      <p className="mb-4 text-sm text-muted">
        Replaces text across brand-safe string metadata (name, description, author,
        license, …). Structural keys —{" "}
        <code className="font-mono text-xs">general.architecture</code>,{" "}
        <code className="font-mono text-xs">tokenizer.*</code>, and the model&apos;s own
        architecture namespace — are deliberately left alone so the file stays
        loadable in llama.cpp, Ollama, and LM Studio.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Find">
          <input
            className="input"
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Qwen"
            autoFocus
          />
        </Field>
        <Field label="Replace with">
          <input
            className="input"
            value={replace}
            onChange={(event) => setReplace(event.target.value)}
            placeholder="Reges"
          />
        </Field>
      </div>

      <Toggle
        checked={caseSensitive}
        onChange={setCaseSensitive}
        label="Case sensitive"
      />
      <Toggle
        checked={includeFilename}
        onChange={setIncludeFilename}
        label="Rename the output file too"
        hint="Only when writing directly, and only if the term appears in the filename."
      />

      <div className="mt-4">
        <span className="label">
          Preview {preview ? `(${preview.length} field${preview.length === 1 ? "" : "s"})` : ""}
        </span>
        {!find.trim() ? (
          <p className="text-sm text-faint">Enter a search term to preview matches.</p>
        ) : hasPreview ? (
          <EditSummary edits={preview!} />
        ) : (
          <p className="text-sm text-muted">
            No brand-safe metadata field contains “{find}”.
          </p>
        )}
      </div>

      <p className="mb-4 text-xs text-faint">
        <strong className="font-medium">Stage changes</strong> adds these to your
        pending list to review and save later.{" "}
        <strong className="font-medium">Apply &amp; write</strong> writes them right
        now — any other change you already staged stays pending and is not
        included.
      </p>

      <OutputOptionsFields
        value={output}
        onChange={setOutput}
        sourceFilename={file.filename}
      />
    </Modal>
  );
}

/* --------------------------------------------------------------------------
   Add-field dialog
   -------------------------------------------------------------------------- */

export function AddFieldDialog({
  open,
  onClose,
  onStage,
  existingKeys,
}: {
  open: boolean;
  onClose: () => void;
  onStage: (edit: MetadataEdit) => void;
  existingKeys: string[];
}) {
  const [key, setKey] = useState("");
  const [valueType, setValueType] = useState<ScalarValueType>("STRING");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKey("");
      setValueType("STRING");
      setValue("");
      setError(null);
    }
  }, [open]);

  function submit() {
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      setError("A metadata key is required.");
      return;
    }
    const parsed = parseValue(value, valueType);
    if (parsed === null) {
      setError(`“${value}” is not a valid ${valueType} value.`);
      return;
    }
    onStage({ op: "set", key: trimmedKey, value: parsed, value_type: valueType });
    onClose();
  }

  const overwrites = existingKeys.includes(key.trim());

  return (
    <Modal
      open={open}
      title="Add metadata field"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={submit}>
            Stage field
          </button>
        </>
      }
    >
      {error && (
        <div className="mb-3">
          <Banner onDismiss={() => setError(null)}>{error}</Banner>
        </div>
      )}
      <Field label="Key" hint="Convention: dotted lowercase, e.g. general.author">
        <input
          className="input font-mono"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          placeholder="general.author"
          autoFocus
        />
      </Field>
      {overwrites && (
        <p className="mb-3 text-xs text-accent">
          This key already exists — saving will overwrite its current value.
        </p>
      )}
      <Field label="Type">
        <select
          className="input"
          value={valueType}
          onChange={(event) => setValueType(event.target.value as ScalarValueType)}
        >
          {SCALAR_VALUE_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Value">
        <input
          className="input font-mono"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && submit()}
          placeholder={valueType === "BOOL" ? "true" : ""}
        />
      </Field>
    </Modal>
  );
}
