# Deployment

GGUF Editor is built for a single trusted user on a machine that already holds
the model files. There is no authentication and no multi-tenancy — see
[security.md](security.md) before putting it anywhere shared.

## Docker Compose

```bash
MODELS_DIR=~/.ollama/models docker compose up --build
```

| Variable | Default | Purpose |
| --- | --- | --- |
| `MODELS_DIR` | `./models` | Host directory mounted at `/models` in the backend |
| `BACKEND_PORT` | `8000` | Host port for the API |
| `FRONTEND_PORT` | `3000` | Host port for the UI |

The compose file wires three things together for you:

- `MODELS_DIR` is mounted at `/models` and seeded as a root named "Models" via
  `GGUF_EDITOR_DEFAULT_ROOTS`.
- `GGUF_EDITOR_CORS_ORIGINS` is derived from `FRONTEND_PORT`.
- `NEXT_PUBLIC_API_BASE_URL` is passed as a **build arg** from `BACKEND_PORT`.

Because the API URL is baked into the browser bundle at build time, changing
`BACKEND_PORT` requires `docker compose up --build`, not just a restart.

State lives in the named volume `gguf-editor-data` (mounted at `/data`):
the SQLite database, the encryption key, and backups. Removing that volume
resets registered roots and providers, and makes existing encrypted API keys
unrecoverable.

Mount your models read-only if you only want to inspect:

```yaml
volumes:
  - "${MODELS_DIR:-./models}:/models:ro"
```

Saving then fails with a permission error, which is the intended outcome.

## Images individually

```bash
# Backend
docker build -t gguf-editor-backend ./backend
docker run --rm -p 8000:8000 \
  -v ~/.ollama/models:/models \
  -v gguf-editor-data:/data \
  -e GGUF_EDITOR_DEFAULT_ROOTS="Ollama:/models" \
  gguf-editor-backend

# Frontend
docker build -t gguf-editor-frontend \
  --build-arg NEXT_PUBLIC_API_BASE_URL=http://localhost:8000/api ./frontend
docker run --rm -p 3000:3000 gguf-editor-frontend
```

Both images run as a non-root user (uid 10001). The backend needs write access
to the mounted models directory to save edits, and to `/data` for its database
— adjust ownership on the host if your files are owned by another uid.

## Running on another machine

If the backend is not on `localhost` from the browser's point of view:

1. Rebuild the frontend with
   `NEXT_PUBLIC_API_BASE_URL=http://<host>:8000/api`.
2. Set `GGUF_EDITOR_CORS_ORIGINS=http://<host>:3000` on the backend.
3. Put both behind something that provides TLS and authentication — a reverse
   proxy with basic auth, an SSH tunnel, or a VPN. The backend has no login of
   its own, and it can read and overwrite every file under a registered root.

An SSH tunnel is usually the least work:

```bash
ssh -L 3000:localhost:3000 -L 8000:localhost:8000 user@model-box
```

Then browse to `http://localhost:3000` as if everything were local, with no
rebuild and no CORS change.

## Without Docker

Run Uvicorn behind a process manager and serve the built frontend with
`next start`:

```bash
# backend (systemd unit, supervisor, tmux — anything that restarts it)
cd backend && .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# frontend
cd frontend && npm run build && npm run start
```

`next build` also emits `.next/standalone/server.js`, a self-contained server
that only needs `.next/static` copied alongside it — that is what the Docker
image uses.

## Upgrading

```bash
git pull
docker compose up --build        # or: pip install -r backend/requirements.txt && npm ci
```

The SQLite schema is created with `CREATE TABLE IF NOT EXISTS` on startup;
there are no migrations to run today. Back up `<DATA_DIR>` before upgrading if
you have providers configured — that directory holds the only copy of the key
that decrypts them.
