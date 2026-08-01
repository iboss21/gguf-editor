# Configuration

## Backend

Settings are read from environment variables or a `.env` file next to the
process's working directory, all prefixed `GGUF_EDITOR_`. See
[`backend/.env.example`](../backend/.env.example) for a copy-paste starting
point; the loader lives in `backend/app/config.py`.

| Variable | Default | What it does |
| --- | --- | --- |
| `GGUF_EDITOR_DATA_DIR` | `backend/data` | Where the SQLite DB, Fernet key, and backups live. Created on demand |
| `GGUF_EDITOR_DEFAULT_ROOTS` | *(empty)* | Roots to register on first launch, e.g. `Models:/models,Ollama:~/.ollama/models`. Only applied when no root exists yet |
| `GGUF_EDITOR_CORS_ORIGINS` | `http://localhost:3000,http://127.0.0.1:3000` | Comma-separated origins allowed to call the API |
| `GGUF_EDITOR_MAX_INLINE_ARRAY_ITEMS` | `32` | Array metadata longer than this is truncated to a preview and marked read-only |
| `GGUF_EDITOR_LLM_REQUEST_TIMEOUT` | `120` | Seconds to wait on a provider request |

### Notes

- **`DEFAULT_ROOTS` format.** Entries are separated by commas (or by the
  platform path separator if one is present). Each entry is either
  `label:path` or a bare `path`, in which case the folder name becomes the
  label. Windows drive letters (`C:\models`) are handled.
- **The seed only runs once.** If the `roots` table already has a row, the
  variable is ignored — so removing a seeded root in the UI makes it stay
  removed.
- **`DATA_DIR` holds secrets.** It contains `secret.key`, the Fernet key that
  encrypts provider API keys. Deleting it makes stored keys undecryptable; the
  backend then raises a clear error instead of returning garbage.
- **CORS matters in Docker.** The browser's origin is what counts, so it must
  match the port you actually load the UI from.

Files created under `DATA_DIR`:

```
data/
  gguf_editor.db          SQLite: roots, providers, settings
  secret.key              Fernet key, chmod 0600 where the OS allows it
  backups/<root_id>/      <rel_path>.<UTC timestamp>.bak
```

## Frontend

| Variable | Default | What it does |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000/api` | Backend base URL, including `/api` |

Because it is a `NEXT_PUBLIC_*` variable it is **inlined at build time**, not
read at runtime. In development, put it in `frontend/.env.local`. For a
container image, pass it as a build argument:

```bash
docker build --build-arg NEXT_PUBLIC_API_BASE_URL=http://192.168.1.10:8000/api ./frontend
```

The value must be reachable **from the browser**, not from inside the
container — requests are made by the user's browser, never server-side.

## Ports

| Service | Default | Change it with |
| --- | --- | --- |
| Backend | 8000 | `uvicorn --port …`, or `BACKEND_PORT` in compose |
| Frontend | 3000 | `next dev -p …` / `PORT=…`, or `FRONTEND_PORT` in compose |

Changing either port means updating the other side: `GGUF_EDITOR_CORS_ORIGINS`
for the backend, `NEXT_PUBLIC_API_BASE_URL` for the frontend.
