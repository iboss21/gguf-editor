# API reference

Base URL: `http://localhost:8000/api`. Every endpoint is JSON in / JSON out.
FastAPI serves interactive docs at `/docs` and the OpenAPI schema at
`/openapi.json` — this page is the narrated version.

Errors use FastAPI's standard shape:

```json
{ "detail": "Only .gguf files are supported" }
```

| Status | Meaning here |
| --- | --- |
| 400 | Bad path (escapes its root), non-`.gguf` target, or empty edit list |
| 404 | Unknown `root_id` / `provider_id`, or the file does not exist |
| 409 | Root already registered |
| 422 | GGUF read/write failure, bad value type, nothing to rebrand |
| 502 | The LLM provider call failed |

---

## Health

### `GET /api/health`

```json
{ "status": "ok", "service": "gguf-editor-backend" }
```

---

## Explorer

### `GET /api/explorer/roots`

Registered root directories. `exists` is re-checked on every call, so a root
whose folder was unmounted shows up as `false` rather than disappearing.

```json
[
  {
    "id": "ad8e0f310ee8",
    "label": "Models",
    "path": "/home/you/models",
    "exists": true,
    "created_at": "2026-08-01T15:52:43.981639+00:00"
  }
]
```

### `POST /api/explorer/roots`

```json
{ "path": "~/.ollama/models", "label": "Ollama" }
```

`~` and environment variables are expanded, and the path is resolved to an
absolute path before storage. `label` defaults to the folder name. Returns
`201` with the `RootInfo`; `400` if the path doesn't exist or isn't a
directory, `409` if it is already registered.

### `DELETE /api/explorer/roots/{root_id}`

`204`. Unregisters the folder — no files are touched.

### `GET /api/explorer/browse?root_id=…&path=…`

Lists one directory level. `path` is relative to the root (empty = the root
itself). Directories sort before files, both case-insensitively.

```json
{
  "root_id": "ad8e0f310ee8",
  "rel_path": "",
  "parent_rel_path": null,
  "entries": [
    {
      "name": "qwen2-test-7b.gguf",
      "rel_path": "qwen2-test-7b.gguf",
      "is_dir": false,
      "is_gguf": true,
      "size_bytes": 2272,
      "modified_at": "2026-08-01T15:44:23.010613+00:00"
    }
  ]
}
```

Hidden (dot-prefixed) entries are skipped. A `path` containing `..` that would
leave the root is rejected with `400`.

### `GET /api/explorer/search?root_id=…&query=…&limit=200`

Recursive substring search over `.gguf` filenames under the root. Hidden
directories are pruned. Returns the same `EntryInfo` objects, capped at `limit`.

---

## GGUF

### `POST /api/gguf/inspect`

```json
{ "root_id": "ad8e0f310ee8", "rel_path": "qwen2-test-7b.gguf" }
```

```json
{
  "root_id": "ad8e0f310ee8",
  "rel_path": "qwen2-test-7b.gguf",
  "filename": "qwen2-test-7b.gguf",
  "size_bytes": 2272,
  "architecture": "qwen2",
  "endian": "LITTLE",
  "metadata": [
    {
      "key": "general.name",
      "value": "Qwen2-Test-7B",
      "value_type": "STRING",
      "array_value_type": null,
      "is_array": false,
      "array_length": null,
      "truncated": false,
      "editable": true,
      "modified": false
    }
  ],
  "tensor_count": 3,
  "tensors": [
    { "name": "blk.0.attn_q.weight", "shape": [8, 8], "dtype": "F32", "n_elements": 64 }
  ],
  "total_parameters": 192
}
```

Notes on `metadata` entries:

- `value_type` is the GGUF type name (`STRING`, `BOOL`, `UINT32`, `INT64`,
  `FLOAT32`, `ARRAY`, …). For arrays, `array_value_type` holds the item type.
- Arrays longer than `GGUF_EDITOR_MAX_INLINE_ARRAY_ITEMS` (default 32) come
  back truncated: `truncated: true`, `editable: false`, with `array_length`
  reporting the real size.
- `GGUF.version`, `GGUF.tensor_count`, and `GGUF.kv_count` are header fields
  synthesized by the reader. They are returned with `editable: false`, and any
  edit targeting them is rejected with `422`.
- `modified` is always `false` here; it is used by the in-memory preview the
  chat endpoint returns.

Tensor data is not read — only the header, key/value block, and tensor
descriptors.

### `POST /api/gguf/metadata`

Apply a list of edits and write the result.

```json
{
  "root_id": "ad8e0f310ee8",
  "rel_path": "qwen2-test-7b.gguf",
  "edits": [
    { "op": "set", "key": "general.name", "value": "Reges2-Test-7B", "value_type": "STRING" },
    { "op": "set", "key": "general.tags", "value": ["chat", "test"], "value_type": "ARRAY", "array_value_type": "STRING" },
    { "op": "rename", "key": "general.licence", "new_key": "general.license" },
    { "op": "delete", "key": "general.source.url" }
  ],
  "output": { "mode": "new_name", "filename": "reges2-test-7b.gguf", "backup": true }
}
```

| Field | Notes |
| --- | --- |
| `op` | `set`, `delete`, or `rename` |
| `value_type` | Required for `set`. Determines coercion — a `"42"` string with `UINT32` becomes `42` |
| `array_value_type` | Required when `value_type` is `ARRAY` |
| `new_key` | Required for `rename` |
| `output.mode` | `new_name` (default) or `overwrite` |
| `output.filename` | `new_name` only; no path separators; `.gguf` appended if missing. Defaults to `<stem>-edited.gguf` |
| `output.backup` | Copy the file being replaced into `data/backups/<root_id>/` first |

Response:

```json
{
  "success": true,
  "output_rel_path": "reges2-test-7b.gguf",
  "backup_rel_path": null,
  "file": { "…": "a fresh GGUFFileInfo for the file that was written" }
}
```

`400` when `edits` is empty, `422` on a type mismatch or an edit targeting a
`GGUF.*` header field.

### `POST /api/gguf/rebrand/preview`

```json
{
  "root_id": "ad8e0f310ee8",
  "rel_path": "qwen2-test-7b.gguf",
  "find": "Qwen",
  "replace": "Reges",
  "case_sensitive": false
}
```

Returns the edits a rebrand *would* make — nothing is written:

```json
{
  "edits": [
    { "op": "set", "key": "general.name", "value": "Reges2-Test-7B", "value_type": "STRING", "array_value_type": null, "new_key": null }
  ]
}
```

Only scalar `STRING` fields that pass `is_rebrand_safe_key` are considered.
Pass `keys: ["general.architecture"]` to restrict — or deliberately extend —
the scope. See [architecture.md](architecture.md#why-the-rebrand-tool-has-an-exclusion-list).

### `POST /api/gguf/rebrand`

Same body as the preview, plus `include_filename` (default `true`) and
`output`. Computes the edits and writes them in one call, returning the same
`ApplyEditsResponse` as `/api/gguf/metadata`.

When `include_filename` is set, the output filename gets the same replacement
applied to its stem — but only if the term actually appears in the filename,
and never in `overwrite` mode. Without that guard an auto-generated name could
collapse onto the source file's name and overwrite it.

`422` if no brand-safe field contains `find`.

### `GET /api/gguf/download?root_id=…&rel_path=…`

Streams the file as `application/octet-stream`.

---

## Providers

### `GET /api/providers`

```json
[
  {
    "id": "6c1f2a0b9d34",
    "name": "Ollama",
    "kind": "openai_compatible",
    "scope": "local",
    "base_url": "http://localhost:11434/v1",
    "model": "llama3.1",
    "has_api_key": false,
    "created_at": "2026-08-01T15:52:43+00:00",
    "updated_at": "2026-08-01T15:52:43+00:00"
  }
]
```

API keys are never included in a response — only `has_api_key`.

### `POST /api/providers`

```json
{
  "name": "Anthropic",
  "kind": "anthropic",
  "scope": "byok",
  "base_url": "https://api.anthropic.com",
  "model": "claude-sonnet-4-5",
  "api_key": "sk-ant-…"
}
```

`kind` is `openai_compatible` or `anthropic`; `scope` is `local`, `global`, or
`byok` (labelling only — it does not change request behaviour). Returns `201`.

### `PUT /api/providers/{provider_id}`

Partial update. Omitted fields keep their current value; `api_key` is only
replaced when a non-empty value is sent. Set `clear_api_key: true` to remove a
stored key. `kind` and `scope` are immutable.

### `DELETE /api/providers/{provider_id}`

`204`.

### `POST /api/providers/{provider_id}/test`

Calls the provider's model-listing endpoint (`GET {base_url}/models`, or
`GET {base_url}/v1/models` for Anthropic).

```json
{ "ok": true, "detail": "Connected successfully. 12 model(s) reported.", "models": ["llama3.1", "…"] }
```

Failures come back as `ok: false` with the error text in `detail` — a bad
endpoint is a normal answer here, not an HTTP error. The Anthropic client falls
back to a short built-in model list if the listing endpoint is unavailable.

---

## Chat

### `POST /api/chat`

Runs one assistant turn, including any tool calls it makes.

```json
{
  "provider_id": "6c1f2a0b9d34",
  "messages": [{ "role": "user", "content": "Rebrand this model from Qwen to Reges" }],
  "target": { "root_id": "ad8e0f310ee8", "rel_path": "qwen2-test-7b.gguf" },
  "pending_edits": [],
  "auto_apply": false
}
```

- `messages` is the full conversation so far; the backend is stateless between
  calls.
- `target` may be `null` — the assistant then answers general questions and has
  no tools.
- `pending_edits` seeds the turn with edits already staged in the UI, so a
  multi-turn conversation accumulates instead of restarting.
- `auto_apply: true` writes the resulting edits with the default output options
  (`new_name`, backup on) as soon as the turn finishes.

```json
{
  "message": { "role": "assistant", "content": "I renamed three fields…" },
  "tool_events": [
    {
      "tool": "bulk_rebrand",
      "args": { "find": "Qwen", "replace": "Reges" },
      "result": "Rebranded 3 field(s): general.name -> 'Reges2-Test-7B'; …"
    }
  ],
  "pending_edits": [
    { "op": "set", "key": "general.name", "value": "Reges2-Test-7B", "value_type": "STRING", "array_value_type": null, "new_key": null }
  ],
  "metadata_preview": [{ "key": "general.name", "value": "Reges2-Test-7B", "modified": true, "…": "…" }],
  "applied": false,
  "output_rel_path": null
}
```

`404` for an unknown `provider_id`, `502` when the provider call fails. Tool
errors are *not* HTTP errors: they are returned to the model as text and show
up in `tool_events`.

Available tools: `set_metadata`, `delete_metadata`, `rename_metadata_key`,
`bulk_rebrand`, `set_output_filename`. The loop stops after 6 tool rounds and
returns what it has.
