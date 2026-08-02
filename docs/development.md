# Development

## Setup

```bash
# Backend — Python 3.12+
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# Frontend — Node 20+
cd frontend
npm install
npm run dev
```

`requirements-dev.txt` includes the runtime requirements plus pytest and ruff.

## Checks

Everything CI runs, runnable locally:

```bash
# backend
cd backend
python -m pytest              # 112 tests
python -m ruff check app tests

# frontend
cd frontend
npm run lint
npm run typecheck
npm run build
```

The test suite needs no network and no model files: `tests/conftest.py`
synthesizes a small real GGUF file with `GGUFWriter`, and each test gets its
own `GGUF_EDITOR_DATA_DIR` under `tmp_path` so the SQLite database and
encryption key are never shared between tests.

LLM providers are exercised through `httpx.MockTransport`, so the tool-calling
loop is covered end to end without calling anyone.

## Layout and conventions

```
backend/app/
  api/       Thin route handlers. They validate, delegate, and map domain
             exceptions to HTTPException — no business logic here.
  core/      Where the work happens. Raises domain exceptions
             (GGUFHandlerError, PathSecurityError, RootNotFoundError, …).
  models/    Pydantic schemas. The single source of truth for the JSON
             contract; mirrored in frontend/lib/types.ts.
  db.py      sqlite3 helpers: get_conn() context manager, new_id(), now_iso().

frontend/
  app/page.tsx     The workspace: owns file, staged edits, and dialog state.
  components/      Presentational units; state is lifted to page.tsx.
  lib/api.ts       Every backend call. Nothing else calls fetch().
  lib/edits.ts     Mirrors the backend's in-memory edit helpers.
```

- **Python**: ruff with `E, F, I, B, UP`, line length 120, target py312. Modules
  start with a docstring explaining *why* the module exists.
- **TypeScript**: strict mode; `@/…` path alias; no `any` in exported types.
- **Styling**: Tailwind v4 with semantic tokens (`bg-surface`, `text-muted`,
  `border-line`, …) defined in `app/globals.css`. Both colour schemes are
  driven from one set of CSS variables — don't hardcode hex values in
  components.

## Adding an endpoint

1. Add or extend the Pydantic models in `app/models/schemas.py`.
2. Implement the behaviour in `app/core/…`, raising domain exceptions.
3. Add the route in `app/api/routes_*.py`, translating those exceptions into
   `HTTPException`.
4. Mirror the types in `frontend/lib/types.ts` and add a method to
   `frontend/lib/api.ts`.
5. Cover it in `backend/tests/` — both the core function and the HTTP layer.

## Working on the GGUF write path

This is the risky part of the codebase: a bug here damages user model files.

- Never load tensor data into Python. `write_with_edits` streams it from the
  memory-mapped source; keep it that way.
- Never write directly to the destination. Writes go to
  `.<name>.tmp-<random>.gguf` and are swapped in with `os.replace`.
- `GGUF.*` keys are synthesized by the reader from the file header — they are
  skipped when copying fields, and edits targeting them are rejected.
- After any change here, verify a round-trip: write a file, re-read it with
  `GGUFReader`, and check both the metadata *and* that tensor bytes are
  identical. `test_perform_edit_new_name_preserves_tensors_and_applies_edits`
  is the model to follow.

## Manual smoke test

Build a throwaway model file, register it, and drive the UI:

```python
# scratch.py — run inside backend/.venv
import numpy as np
from gguf import GGUFWriter

w = GGUFWriter("/tmp/models/qwen2-test.gguf", arch="qwen2")
w.add_name("Qwen2-Test-7B")
w.add_description("A Qwen2 based test model produced by the Qwen team.")
w.add_author("Qwen")
w.add_block_count(4)
w.add_tensor("blk.0.attn_q.weight", np.random.rand(8, 8).astype(np.float32))
w.write_header_to_file(); w.write_kv_data_to_file(); w.write_tensors_to_file(); w.close()
```

Then add `/tmp/models` as a root and try: inline edit → Save as new file →
Rebrand "Qwen" → "Reges" → confirm `general.architecture` is still `qwen2`.
