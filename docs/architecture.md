# Architecture

## Components

```
frontend/  Next.js 15 (App Router, React 19, Tailwind v4)
           Single client-rendered workspace; no server-side data fetching,
           no database. Talks to the backend over REST from the browser.

backend/   FastAPI + Uvicorn
           app/api/     routes, HTTP error mapping
           app/core/    the actual work: gguf, filesystem, providers, agent
           app/models/  Pydantic schemas (the JSON contract)
           app/db.py    hand-rolled SQLite layer (roots, providers, settings)
           app/security.py  Fernet encryption for API keys

storage/   SQLite database + Fernet key + backups, all under GGUF_EDITOR_DATA_DIR
           (default: backend/data). Model files themselves stay where they are.
```

There is no ORM and no message queue: the app is single-user and local, so a
`sqlite3` connection per request and synchronous file I/O are the right size.
Only the LLM-facing paths are `async`, because they wait on the network.

## Request flow: opening a file

1. The UI calls `GET /api/explorer/roots`, then `GET /api/explorer/browse`.
2. `deps.get_root_or_404` looks the root up in SQLite;
   `fs_handler.resolve_within_root` resolves the requested relative path and
   raises `PathSecurityError` if it lands outside the root.
3. The UI calls `POST /api/gguf/inspect`. `gguf_handler.inspect_file` opens the
   file with `GGUFReader` (memory-mapped — the tensor bytes are never read),
   converts each field to a `MetadataItem` and each tensor to a `TensorItem`.
4. Arrays longer than `GGUF_EDITOR_MAX_INLINE_ARRAY_ITEMS` are truncated to a
   preview and marked `truncated: true, editable: false` — a token list with
   150 000 entries is not something to render in a table.
5. `GGUF.*` fields are synthesized by the reader from the file header. They are
   returned for transparency but marked `editable: false`, and the write path
   rejects edits that target them.

## Request flow: saving an edit

```
UI (staged edits)
  └── POST /api/gguf/metadata  { root_id, rel_path, edits[], output }
        └── gguf_handler.perform_edit
              ├── _plan_edits          → (sets, deletes, renames), validated + coerced
              ├── write_with_edits     → GGUFWriter to a temp file
              │     ├── copy every source field, applying renames/sets/deletes
              │     ├── append brand-new keys
              │     └── stream tensor data straight from the mmap'd source
              ├── optional backup      → data/backups/<root_id>/<name>.<ts>.bak
              └── os.replace(tmp, final)   ← atomic swap
```

Two properties fall out of this design:

- **Tensors are never rewritten.** `write_tensor_data` copies bytes from the
  source mapping, so a 40 GB model edit costs a file copy, not 40 GB of RAM.
- **A crash cannot corrupt the source.** Everything lands in
  `.<name>.tmp-<random>.gguf` first; the original is only replaced by an atomic
  `os.replace` after a successful write.

Type handling lives in `value_type_from_name` / `coerce_value`: the API accepts
plain JSON values plus a GGUF type name (`STRING`, `UINT32`, `FLOAT32`, …) and
coerces them, raising `GGUFHandlerError` — surfaced as HTTP 422 — on a mismatch.

## Staged edits and the in-memory preview

The editor never mutates the file as you type. `MetadataEdit` objects accumulate
in React state; `lib/edits.ts` applies them to the last-inspected metadata list
to render the preview, mirroring `gguf_handler.apply_edits_in_memory` on the
server. The same functions exist on both sides on purpose:

| Concern | Frontend (`lib/edits.ts`) | Backend (`app/core/gguf_handler.py`) |
| --- | --- | --- |
| Merge edits, latest-per-key wins | `mergeEdits` | `merge_edits` |
| Preview effective metadata | `applyEditsInMemory` | `apply_edits_in_memory` |
| Guess a type for a new key | `inferValueType` | `infer_value_type` |

The backend copy is what the chat endpoint uses to build the model's system
prompt and to return `metadata_preview`; the frontend copy keeps the table
responsive without a round-trip. The backend remains authoritative — the edit
list is replayed there on save.

## The agentic chat loop

`POST /api/chat` is one full turn:

1. Resolve the provider, build an `OpenAICompatibleClient` or `AnthropicClient`.
2. If a file is open, inspect it and build a `ToolContext` seeded with the
   edits already staged in the UI, plus a system prompt listing the current
   (effective) metadata.
3. `run_conversation` posts to the provider and loops while the model returns
   tool calls, up to `MAX_TOOL_ITERATIONS` (6). Each call is executed by
   `agent_tools.execute_tool_call`, which mutates the `ToolContext` only.
4. The response carries the assistant text, a flat `tool_events` list (shown as
   chips in the UI), the resulting `pending_edits`, and a `metadata_preview`.
5. With `auto_apply: true`, the endpoint then runs the same `perform_edit` path
   the manual save uses, and reports `applied` + `output_rel_path`.

Tool failures are returned to the model as text rather than raised, so one bad
argument doesn't kill the turn.

## Why the rebrand tool has an exclusion list

A naive find/replace of "Qwen" → "Reges" across all string metadata also
rewrites `general.architecture` from `qwen2` to `reges2`, and llama.cpp then
refuses to load the file. `is_rebrand_safe_key` excludes:

- `general.architecture`, `general.alignment`, `general.file_type`,
  `general.quantization_version`
- anything under `tokenizer.`
- anything under the file's own architecture namespace (`qwen2.*`)
- the synthetic `GGUF.*` header fields

Callers who really mean it can pass explicit `keys` to override the default
scope — the UI never does, but the API and the assistant's `bulk_rebrand` tool
both allow it.
