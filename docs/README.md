# GGUF Editor documentation

Start here. The [root README](../README.md) covers what the project is and how
to get it running; these pages go deeper.

| Document | Read it when you want to… |
| --- | --- |
| [architecture.md](architecture.md) | Understand the moving parts and how an edit flows from click to disk |
| [api-reference.md](api-reference.md) | Call the backend directly, or add an endpoint |
| [configuration.md](configuration.md) | Change ports, data directories, CORS, or seed roots |
| [providers.md](providers.md) | Wire up Ollama / LM Studio / OpenAI / Groq / Anthropic |
| [deployment.md](deployment.md) | Run it under Docker, or on a machine other than your laptop |
| [development.md](development.md) | Run the tests and linters, or contribute a change |
| [security.md](security.md) | Know exactly what the backend can reach and how secrets are held |
| [troubleshooting.md](troubleshooting.md) | Fix something that isn't working |

## Concepts in one paragraph each

**Root** — a directory you explicitly register. The backend can only list,
read, and write files inside a registered root; every request path is resolved
and checked against it. Roots live in SQLite and are managed from the sidebar.

**Metadata edit** — one of three operations (`set`, `delete`, `rename`) against
a metadata key. Edits are *staged*: the UI keeps a list, previews the result
in-memory, and only sends it to the backend when you save. The backend replays
the same list when it writes the file.

**Output options** — how a save is written: `new_name` (default, writes a new
`.gguf` next to the original) or `overwrite`, with an optional backup of
whatever file is being replaced.

**Provider** — an LLM endpoint the assistant can call, described by an API
shape (`openai_compatible` or `anthropic`), a base URL, an optional model id,
and an optional API key that is encrypted at rest.

**Tool call** — the assistant doesn't write files directly. It calls tools
(`set_metadata`, `bulk_rebrand`, …) that mutate an in-memory edit list for the
current turn; that list comes back to the UI as staged edits, or is written
immediately when auto-apply is on.
