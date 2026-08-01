# gguf-editor

A local-first, browser-based viewer and editor for [GGUF](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md) model files &mdash; the format used by [llama.cpp](https://github.com/ggml-org/llama.cpp) and compatible LLM inference runtimes.

Open a `.gguf` file, inspect and edit its metadata and tensor list, and export the result &mdash; all in your browser tab. Nothing is uploaded anywhere; files never leave your machine.

## Features

- **Drag-and-drop or file picker** loading of `.gguf` files, entirely client-side.
- **Summary panel**: file size, GGUF version, tensor count, metadata count, effective tensor-data alignment.
- **Metadata editor**: view, add, edit, and delete key/value metadata entries.
  - Supports every GGUF value type (all signed/unsigned integer widths, both floats, bool, string, and arrays of any of those).
  - Key autocomplete for well-known keys (`general.architecture`, `general.name`, etc.).
  - Integer inputs are bounds-checked against their declared width before saving.
- **Tensor inspector**: view each tensor's name, type, shape, byte size, and file offset, and rename tensors.
- **Filter boxes** for both the metadata and tensor tables.
- **Export**: rebuilds a valid `.gguf` file reflecting your edits and downloads it.
- **Handles huge files efficiently**: tensor *data* is never read into memory or modified. The parser only reads the (small) header/metadata/tensor-info section of a file, and export reassembles tensor bytes via zero-copy `Blob` slices of the original file. This means multi-gigabyte model files can be opened and edited without exhausting browser memory.

Editing tensor *weight data* (as opposed to metadata) is intentionally out of scope; this tool only changes metadata and tensor names, never quantized weight bytes.

## Usage

No build step or install required for end users &mdash; it's a static site.

1. Serve the repository root over HTTP (see [Development](#development) below), since browsers block ES module imports from `file://` URLs.
2. Open the served `index.html` in a browser.
3. Drag a `.gguf` file onto the drop zone, or click "Choose a file&hellip;".
4. Edit metadata entries or rename tensors as needed.
5. Click "Export edited GGUF" to download the modified file.

## Development

Requires Node.js 20 or later.

```sh
npm start   # serves the app at http://127.0.0.1:8080/
npm test    # runs the unit test suite (node's built-in test runner)
```

### Architecture

- `src/gguf/` &mdash; a standalone GGUF binary format library (parsing and serialization), with no dependency on the DOM. It can also be used from Node.
  - `parser.mjs` reads the header, metadata, and tensor-info table using an adaptively-sized read window, then represents each tensor as a lazy `{ fileOffset, length }` reference into the original file &mdash; tensor data itself is never loaded into memory.
  - `serializer.mjs` rebuilds the header/metadata/tensor-info from the in-memory model and reassembles the full file as a `Blob`, copying tensor bytes via zero-copy `Blob#slice()` calls on the original file.
  - `constants.mjs`, `byte-reader.mjs`, `byte-writer.mjs`, `value-codec.mjs`, `tensor-size.mjs`, `alignment.mjs`, `blob-source.mjs` are supporting modules for the format's binary details (value types, tensor quantization block sizes, alignment rules, etc).
- `src/value-format.mjs` &mdash; pure formatting/parsing helpers shared by the UI (e.g. human-readable byte sizes, converting between typed values and editable text).
- `src/app.mjs` &mdash; DOM wiring for `index.html`: file loading, table rendering, dialogs, and export.
- `scripts/dev-server.mjs` &mdash; a zero-dependency static file server used for local development and testing.
- `test/` &mdash; unit tests (`node --test`) for the library and formatting layers, including round-trip export tests that catch regressions in metadata/tensor editing.

## License

Released under CC0 1.0 Universal (public domain dedication) &mdash; see [LICENSE](./LICENSE).