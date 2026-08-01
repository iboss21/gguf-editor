# GGUF Editor

A local-first tool for browsing, inspecting, and editing the metadata of
[GGUF](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md) model files —
the format used by llama.cpp, Ollama, and LM Studio.

Point it at a models folder, open a `.gguf` file, and edit its metadata in a
table — or describe the change in plain language and let an LLM make it for
you. Tensor data is never touched: edits rewrite only the key/value block, and
the result is written atomically so an interrupted save can't corrupt a model.

```
┌──────────────┐        ┌───────────────────┐        ┌──────────────────┐
│  Next.js UI  │ ─────▶ │  FastAPI backend  │ ─────▶ │  .gguf on disk   │
│  (port 3000) │  REST  │   (port 8000)     │  gguf  │  (registered     │
└──────────────┘        └─────────┬─────────┘   lib  │   roots only)    │
                                  │                  └──────────────────┘
                                  ▼
                    Ollama / LM Studio / OpenAI /
                    Groq / Anthropic  (your choice)
```

## Features

- **Explorer** — register one or more model root folders and browse or
  recursively search them for `.gguf` files. The backend refuses to read
  outside a registered root.
- **Inspector** — every metadata key/value with its GGUF type, plus the full
  tensor table (name, shape, dtype, element count) and file-level facts
  (architecture, endianness, parameter count).
- **Editor** — edit values inline, rename keys, delete keys, and add new
  fields. Changes are staged and previewed before anything is written.
- **Bulk rebrand** — find/replace across brand-safe string fields
  (`general.name`, `general.description`, `general.author`, …) with a live
  preview. Structural keys are excluded by default so the file stays loadable.
- **AI assistant** — a tool-calling chat that stages the same edits from
  natural language ("rebrand this model from Qwen to Reges"). Works with local
  runtimes or hosted APIs; optional auto-apply writes changes straight to disk.
- **Safe writes** — save as a new file or overwrite in place, with an optional
  timestamped backup. Writes go to a temp file and are swapped in with
  `os.replace`.
- **Encrypted credentials** — provider API keys are encrypted at rest with a
  locally generated Fernet key and are never returned to the browser.

## Quickstart

### Docker (both services)

```bash
git clone https://github.com/iboss21/gguf-editor.git
cd gguf-editor
MODELS_DIR=~/.ollama/models docker compose up --build
```

Open <http://localhost:3000>. The mounted folder is registered as a root named
"Models" automatically on first start.

### Local development

Two terminals, Python 3.12+ and Node 20+:

```bash
# 1 — backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

```bash
# 2 — frontend
cd frontend
npm install
npm run dev
```

Open <http://localhost:3000>, click **Add a models folder**, and enter the
absolute path of a directory containing `.gguf` files (e.g.
`~/.ollama/models`, `~/.cache/lm-studio/models`).

Interactive API docs are served by FastAPI at <http://localhost:8000/docs>.

## Connecting an LLM

The assistant is optional — the explorer and editor work without it. To enable
it, open **Providers** in the header and add one:

| Runtime | Kind | Base URL | Key |
| --- | --- | --- | --- |
| Ollama | OpenAI-compatible | `http://localhost:11434/v1` | not needed |
| LM Studio | OpenAI-compatible | `http://localhost:1234/v1` | not needed |
| OpenAI | OpenAI-compatible | `https://api.openai.com/v1` | required |
| Groq | OpenAI-compatible | `https://api.groq.com/openai/v1` | required |
| Anthropic | Anthropic | `https://api.anthropic.com` | required |

Use **Test** to verify the endpoint and list the models it reports. See
[docs/providers.md](docs/providers.md) for scopes (Local / Global / BYOK) and
how keys are stored.

## Project layout

```
backend/            FastAPI service
  app/api/          HTTP routes (explorer, gguf, providers, chat, health)
  app/core/         GGUF read/write, filesystem, providers, agent tools
  app/models/       Pydantic schemas — the JSON contract with the UI
  tests/            pytest suite (112 tests, no network required)
frontend/           Next.js App Router UI
  app/              Layout + the single-page workspace
  components/       Explorer, tables, dialogs, chat panel, primitives
  lib/              Typed API client, shared types, edit helpers
docs/               Documentation (start at docs/README.md)
```

## Documentation

| Document | Contents |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | How the pieces fit together and how an edit flows end to end |
| [docs/api-reference.md](docs/api-reference.md) | Every endpoint with request/response examples |
| [docs/configuration.md](docs/configuration.md) | Environment variables for both services |
| [docs/providers.md](docs/providers.md) | LLM provider setup, scopes, and the tool-calling loop |
| [docs/deployment.md](docs/deployment.md) | Docker images, compose, and remote-host notes |
| [docs/development.md](docs/development.md) | Running tests and linters, project conventions |
| [docs/security.md](docs/security.md) | Threat model, path scoping, key encryption |
| [docs/troubleshooting.md](docs/troubleshooting.md) | Common failures and their fixes |

## Safety notes

- GGUF Editor is designed for **single-user, local** use. It has no
  authentication — do not expose the backend to an untrusted network.
- Editing `general.architecture` or `tokenizer.*` can make a model unloadable.
  The rebrand tool skips them by default; overriding that is deliberate.
- Prefer "save as a new file" until you trust a change. Backups land in the
  backend's data directory (`data/backups/<root_id>/`).

## License

[CC0 1.0 Universal](LICENSE) — public domain dedication.
