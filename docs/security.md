# Security

## What this app is

A single-user tool that runs on the machine holding your model files. It has
**no authentication**. Anyone who can reach the backend can list, read,
overwrite, and download every file under a registered root, and can make it
issue outbound requests to configured LLM providers.

Bind it to `localhost`, or put it behind a proxy or tunnel that provides
authentication. Do not expose port 8000 to a network you don't control.

## Filesystem scope

The backend never accepts an arbitrary path. Two layers enforce this:

1. **Roots.** Only directories you explicitly register are reachable. They are
   stored in SQLite; the API always takes a `root_id` plus a path *relative* to
   that root.
2. **Resolution.** `fs_handler.resolve_within_root` expands `~` and environment
   variables, resolves the path (following symlinks), and then requires the
   result to be inside the resolved root. `..` segments, absolute-path
   overrides, and symlinks pointing outside all fail with `PathSecurityError`
   → HTTP 400.

On top of that, `deps.resolve_gguf_path` rejects anything that isn't an
existing file with a `.gguf` suffix, so the GGUF endpoints can't be used to
read or serve arbitrary files inside a root.

Registering `/` would hand the app your whole filesystem. Register the narrow
directory that actually holds models.

## Writes

- Output filenames are rejected if they contain a path separator or are `.` /
  `..`, so a save can only ever land in the source file's own directory.
- Every write goes to a temporary file in that directory and is moved into
  place with `os.replace`. An interrupted write leaves the original intact and
  a stray `.tmp-*.gguf` behind.
- With `backup: true` (the default), whatever file is about to be replaced is
  copied to `<DATA_DIR>/backups/<root_id>/<rel_path>.<timestamp>.bak` first.
  Backups are never pruned — they will accumulate.
- Overwrite mode is genuinely destructive to the original. The UI defaults to
  "save as a new file".

## Secrets

Provider API keys are the only secrets the app stores.

- Encrypted with Fernet (AES-128-CBC + HMAC) before being written to SQLite.
- The key is generated on first use at `<DATA_DIR>/secret.key` and chmod'd
  `0600` where the OS supports it. It is *not* derived from a password: anyone
  who can read that file and the database can recover the keys.
- Decryption happens server-side only, immediately before an outbound request.
- API responses expose `has_api_key: boolean` and never the value. There is no
  endpoint that returns a stored key.
- Deleting `secret.key` makes existing keys undecryptable; the backend raises a
  clear error rather than silently sending garbage upstream.

## Data sent to LLM providers

When you use the assistant with a file open, the system prompt contains that
file's metadata: keys, scalar values, and array *summaries* (large arrays are
listed as `[array of N TYPE] (omitted)`). Tensor data and model weights are
never sent. With a `local` provider nothing leaves the machine.

Tool arguments returned by the model are treated as untrusted input: they are
validated and coerced, and a bad argument produces a text error handed back to
the model rather than an exception. The model cannot write to disk directly —
it can only stage edits, which the user reviews unless auto-apply is enabled.

## CORS

`GGUF_EDITOR_CORS_ORIGINS` controls which browser origins may call the API.
The default allows only `localhost:3000` / `127.0.0.1:3000`. `allow_credentials`
is on, so wildcarding the origin list is not a safe shortcut — list the exact
origins you serve the UI from.

## Reporting a problem

Open an issue at <https://github.com/iboss21/gguf-editor/issues>. Please don't
include API keys, absolute paths that identify you, or model files.
