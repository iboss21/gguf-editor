# Troubleshooting

## The header says "backend offline"

The UI can't reach `NEXT_PUBLIC_API_BASE_URL`.

```bash
curl http://localhost:8000/api/health     # → {"status":"ok",...}
```

- Not running? `cd backend && uvicorn app.main:app --port 8000`.
- Running on another port or host? The URL is **baked in at build time** —
  rebuild the frontend with the right `NEXT_PUBLIC_API_BASE_URL` (see
  [configuration.md](configuration.md)).

## Requests fail with a CORS error in the browser console

The origin you loaded the UI from isn't in `GGUF_EDITOR_CORS_ORIGINS`. Note
that `http://localhost:3000` and `http://127.0.0.1:3000` are *different*
origins — the default allows both, but a custom port needs adding explicitly.

## "Directory does not exist" when adding a root

The path is resolved **on the machine running the backend**. Under Docker that
means the path inside the container: mount your models at `/models` and
register `/models`, not the host path.

## A registered root shows "missing"

The folder was moved, renamed, or unmounted. Remove it and add it again — no
files are touched either way.

## "Only .gguf files are supported"

The GGUF endpoints work on files whose suffix is `.gguf` (case-insensitive).
Sharded models (`model-00001-of-00002.gguf`) are fine — each shard is a
separate GGUF file, and metadata usually lives in the first one.

## "Failed to read GGUF file"

The file isn't a valid GGUF, is truncated, or is still being downloaded. Ollama
blobs are valid GGUF despite having no extension; copy or symlink one to a
`.gguf` name to open it.

## A metadata value won't save

- **`GGUF.version` / `GGUF.tensor_count` / `GGUF.kv_count`** are header fields
  synthesized by the reader. They're read-only by design; edits are rejected
  with 422.
- **Large arrays** (token lists, merges) come back truncated and are not
  editable in the table. Ask the assistant to set them, or call
  `POST /api/gguf/metadata` directly with the full array.
- **Type mismatch** — a value must parse as its GGUF type. `UINT32` needs an
  integer; the field turns red if the text can't be parsed.

## The edited model won't load in llama.cpp / Ollama / LM Studio

Almost always a structural key was changed. `general.architecture` and the
`tokenizer.*` and `<arch>.*` namespaces must keep their original values — the
rebrand tool skips them for exactly this reason, but a manual edit or an
explicit `keys` override can still change them.

Recover from the backup in `<DATA_DIR>/backups/<root_id>/`, or re-open the
original if you saved to a new file.

## Save fails with a permission error

The backend process needs write access to the *model directory* (that's where
the temp file and output land) and to `<DATA_DIR>`. Under Docker, the container
runs as uid 10001 — either chown the mounted directory or run the container
with a matching user. A `:ro` mount makes saves fail by design.

## The assistant replies but never changes anything

- The model must support tool calling. Many small local models don't, or use it
  unreliably.
- Check the **Test** button on the provider — a 404 on `/models` usually means
  the base URL is missing (or has a doubled) `/v1`.
- Look at the tool chips above each reply. No chips means the model never
  called a tool; wrong arguments show up there as an error string.
- Make sure a file is open. Without one the assistant has no tools at all.

## "I made several edits but reached the tool-call limit"

Six tool rounds per turn is the cap. Ask it to continue — the staged edits from
the previous turn are carried into the next one.

## Provider test fails with an auth error

- OpenAI-compatible: key sent as `Authorization: Bearer <key>`.
- Anthropic: key sent as `x-api-key` with `anthropic-version: 2023-06-01`.

If you rotated a key, edit the provider and paste the new one — leaving the
field blank keeps the old key.

## "Unable to decrypt stored secret"

`<DATA_DIR>/secret.key` changed or was deleted while the database still holds
keys encrypted with the old one. Re-enter the API keys (or restore the old
`secret.key` from a backup).

## Tests fail with `ModuleNotFoundError: No module named 'fastapi'`

Run them inside the virtualenv where you installed `requirements-dev.txt`:

```bash
cd backend && source .venv/bin/activate && python -m pytest
```

## A stray `.tmp-*.gguf` file appeared

A write was interrupted. The original file is untouched — delete the temp file.
