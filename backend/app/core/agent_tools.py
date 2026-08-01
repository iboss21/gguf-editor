"""Tool definitions and execution for the agentic GGUF auto-edit chat.

The chat endpoint gives the LLM a small set of "tools" (function-calling
style) it can invoke to stage metadata changes. Nothing is written to disk
here - tools only mutate an in-memory :class:`ToolContext`, whose resulting
``edits`` list is either (a) returned to the frontend as a draft the user
can review/save, or (b) written to disk by the caller when the user has
enabled "auto-apply".
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from app.core import gguf_handler
from app.models.schemas import EditOp, GGUFFileInfo, MetadataEdit

TOOLS: list[dict[str, Any]] = [
    {
        "name": "set_metadata",
        "description": (
            "Set (add or overwrite) a single GGUF metadata key to a new scalar value. "
            "Omit value_type to keep the field's existing type."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "key": {"type": "string", "description": "Metadata key, e.g. general.name"},
                "value": {"description": "New value; type must match value_type"},
                "value_type": {
                    "type": "string",
                    "enum": [
                        "STRING", "BOOL", "UINT8", "UINT16", "UINT32", "UINT64",
                        "INT8", "INT16", "INT32", "INT64", "FLOAT32", "FLOAT64",
                    ],
                    "description": "Optional; inferred from the existing field (or the value) when omitted.",
                },
            },
            "required": ["key", "value"],
        },
    },
    {
        "name": "delete_metadata",
        "description": "Remove a metadata key from the file.",
        "parameters": {
            "type": "object",
            "properties": {"key": {"type": "string"}},
            "required": ["key"],
        },
    },
    {
        "name": "rename_metadata_key",
        "description": "Rename a metadata key while keeping its current value.",
        "parameters": {
            "type": "object",
            "properties": {
                "old_key": {"type": "string"},
                "new_key": {"type": "string"},
            },
            "required": ["old_key", "new_key"],
        },
    },
    {
        "name": "bulk_rebrand",
        "description": (
            "Find-and-replace a substring across brand-safe string metadata fields "
            "(general.name, description, author, license, tags, ...). Does NOT touch "
            "general.architecture or tokenizer.* internals unless you pass explicit `keys`, "
            "since changing those can make the model file unloadable. Use this for requests "
            "like 'rebrand this model from Qwen to Reges'."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "find": {"type": "string"},
                "replace": {"type": "string"},
                "case_sensitive": {"type": "boolean"},
                "keys": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional explicit metadata keys to restrict (or force) the replacement to.",
                },
            },
            "required": ["find", "replace"],
        },
    },
    {
        "name": "set_output_filename",
        "description": "Suggest the filename to use when the user saves the edited GGUF file.",
        "parameters": {
            "type": "object",
            "properties": {"filename": {"type": "string"}},
            "required": ["filename"],
        },
    },
]


@dataclass
class ToolContext:
    """Mutable state threaded through a single chat turn's tool calls."""

    info: GGUFFileInfo
    edits: list[MetadataEdit] = field(default_factory=list)
    output_filename: str | None = None

    def effective_metadata(self):
        return gguf_handler.apply_edits_in_memory(self.info.metadata, self.edits)

    def merge_edits(self, new_edits: list[MetadataEdit]) -> None:
        self.edits = gguf_handler.merge_edits(self.edits, new_edits)


def build_system_prompt(info: GGUFFileInfo, effective_metadata) -> str:
    lines = [
        "You are the AI assistant embedded in GGUF Editor, a local tool for inspecting and "
        "editing GGUF model files (the format used by llama.cpp, Ollama, and LM Studio).",
        "You help the user edit metadata for the currently open GGUF file by calling the "
        "tools provided. Prefer `bulk_rebrand` for broad rename/rebrand requests, and "
        "`set_metadata` for precise single-field edits. Always briefly summarize what you "
        "changed (or plan to change) in plain language after acting.",
        "Never invent tensor data or claim to change model weights - you can only edit "
        "metadata (text/number fields), not the underlying tensors.",
        "",
        f"Current file: {info.filename} (architecture: {info.architecture or 'unknown'}, "
        f"{info.tensor_count} tensors, {info.size_bytes} bytes on disk).",
        "Current metadata (small/scalar fields only; large arrays are omitted):",
    ]
    for item in effective_metadata:
        if item.is_array and (item.truncated or (item.array_length or 0) > 8):
            lines.append(f"  - {item.key}: [array of {item.array_length} {item.array_value_type}] (omitted)")
            continue
        lines.append(f"  - {item.key} ({item.value_type}) = {item.value!r}")

    return "\n".join(lines)


async def execute_tool_call(ctx: ToolContext, name: str, args: dict[str, Any]) -> str:
    """Execute one tool call against ``ctx``, returning a short text result."""
    handler = _HANDLERS.get(name)
    if handler is None:
        return f"Unknown tool '{name}'; no changes made."
    try:
        return handler(ctx, args)
    except gguf_handler.GGUFHandlerError as exc:
        return f"Could not apply that change: {exc}"
    except Exception as exc:  # noqa: BLE001 - keep the conversation alive on tool errors
        return f"Unexpected error running '{name}': {exc}"


def _handle_set_metadata(ctx: ToolContext, args: dict[str, Any]) -> str:
    key = _require_str(args, "key")
    if "value" not in args:
        raise gguf_handler.GGUFHandlerError("`value` is required")
    value = args["value"]

    existing = next((m for m in ctx.effective_metadata() if m.key == key), None)
    inferred_type = existing.value_type if existing else gguf_handler.infer_value_type(value)[0]
    value_type = args.get("value_type") or inferred_type

    ctx.merge_edits([MetadataEdit(op=EditOp.SET, key=key, value=value, value_type=value_type)])
    return f"Set '{key}' = {value!r} ({value_type})"


def _handle_delete_metadata(ctx: ToolContext, args: dict[str, Any]) -> str:
    key = _require_str(args, "key")
    ctx.merge_edits([MetadataEdit(op=EditOp.DELETE, key=key)])
    return f"Deleted '{key}'"


def _handle_rename_metadata_key(ctx: ToolContext, args: dict[str, Any]) -> str:
    old_key = _require_str(args, "old_key")
    new_key = _require_str(args, "new_key")
    ctx.merge_edits([MetadataEdit(op=EditOp.RENAME, key=old_key, new_key=new_key)])
    return f"Renamed '{old_key}' to '{new_key}'"


def _handle_bulk_rebrand(ctx: ToolContext, args: dict[str, Any]) -> str:
    find = _require_str(args, "find")
    replace = args.get("replace", "")
    case_sensitive = bool(args.get("case_sensitive", False))
    keys = args.get("keys") or None

    preview_info = ctx.info.model_copy(update={"metadata": ctx.effective_metadata()})
    new_edits = gguf_handler.build_rebrand_edits(
        preview_info, find, replace, case_sensitive=case_sensitive, keys=keys
    )

    if not new_edits:
        return f"No brand-safe metadata fields contained '{find}'. Nothing changed."

    ctx.merge_edits(new_edits)
    summary = "; ".join(f"{e.key} -> {e.value!r}" for e in new_edits)
    return f"Rebranded {len(new_edits)} field(s): {summary}"


def _handle_set_output_filename(ctx: ToolContext, args: dict[str, Any]) -> str:
    filename = _require_str(args, "filename")
    ctx.output_filename = filename
    return f"Output filename set to '{filename}'"


def _require_str(args: dict[str, Any], key: str) -> str:
    value = args.get(key)
    if not isinstance(value, str) or not value:
        raise gguf_handler.GGUFHandlerError(f"`{key}` is required")
    return value


_HANDLERS = {
    "set_metadata": _handle_set_metadata,
    "delete_metadata": _handle_delete_metadata,
    "rename_metadata_key": _handle_rename_metadata_key,
    "bulk_rebrand": _handle_bulk_rebrand,
    "set_output_filename": _handle_set_output_filename,
}
