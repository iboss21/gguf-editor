"""GGUF file reading and writing.

Wraps the official `gguf` Python package (the same library used by
llama.cpp's own ``gguf_dump.py`` / ``gguf_new_metadata.py`` scripts) to
expose a small, typed API for the rest of the backend: read metadata +
tensor info, and write a modified copy of a GGUF file while preserving all
tensor data untouched.
"""
from __future__ import annotations

import gc
import os
import shutil
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from gguf import GGUFReader, GGUFValueType, GGUFWriter, Keys, ReaderField

from app.config import get_settings
from app.models.schemas import (
    EditOp,
    GGUFFileInfo,
    MetadataEdit,
    MetadataItem,
    OutputMode,
    OutputOptions,
    TensorItem,
)

# Fields written automatically by GGUFWriter's constructor that must never be
# copied verbatim (doing so would create duplicate GGUF.* housekeeping keys).
_VIRTUAL_PREFIXES = ("GGUF.",)

_INT_TYPES = {
    GGUFValueType.UINT8,
    GGUFValueType.UINT16,
    GGUFValueType.UINT32,
    GGUFValueType.UINT64,
    GGUFValueType.INT8,
    GGUFValueType.INT16,
    GGUFValueType.INT32,
    GGUFValueType.INT64,
}
_FLOAT_TYPES = {GGUFValueType.FLOAT32, GGUFValueType.FLOAT64}


class GGUFHandlerError(Exception):
    """Raised for GGUF read/write failures surfaced to the API layer as 4xx/5xx."""


# --------------------------------------------------------------------------
# Reading
# --------------------------------------------------------------------------


def _field_value_types(field: ReaderField) -> tuple[GGUFValueType, GGUFValueType | None]:
    if not field.types:
        return GGUFValueType.STRING, None
    main_type = field.types[0]
    sub_type = field.types[-1] if main_type == GGUFValueType.ARRAY else None
    return main_type, sub_type


def _field_to_metadata_item(field: ReaderField) -> MetadataItem:
    main_type, sub_type = _field_value_types(field)
    settings = get_settings()
    is_array = main_type == GGUFValueType.ARRAY
    array_length = len(field.data) if is_array else None

    truncated = False
    if is_array and array_length is not None and array_length > settings.max_inline_array_items:
        value = field.contents(slice(0, settings.max_inline_array_items))
        truncated = True
    else:
        value = field.contents()

    return MetadataItem(
        key=field.name,
        value=value,
        value_type=main_type.name,
        array_value_type=sub_type.name if sub_type else None,
        is_array=is_array,
        array_length=array_length,
        truncated=truncated,
        # Large arrays (token lists, merges, ...) aren't practical to hand
        # edit in a table; the AI assistant can still target them by key.
        editable=not truncated,
    )


def _tensor_to_item(tensor: Any) -> TensorItem:
    return TensorItem(
        name=tensor.name,
        shape=[int(d) for d in tensor.shape],
        dtype=tensor.tensor_type.name,
        n_elements=int(tensor.n_elements),
    )


def _open_reader(path: Path) -> GGUFReader:
    try:
        return GGUFReader(str(path), "r")
    except Exception as exc:  # noqa: BLE001 - normalize all failures
        raise GGUFHandlerError(f"Failed to read GGUF file '{path.name}': {exc}") from exc


def inspect_file(path: Path, root_id: str, rel_path: str) -> GGUFFileInfo:
    """Read a GGUF file's metadata and tensor overview without loading tensor data."""
    reader = _open_reader(path)

    metadata = [_field_to_metadata_item(f) for f in reader.fields.values()]
    tensors = [_tensor_to_item(t) for t in reader.tensors]
    arch_field = reader.get_field(Keys.General.ARCHITECTURE)
    architecture = arch_field.contents() if arch_field else None
    total_parameters = sum(int(t.n_elements) for t in reader.tensors) or None

    return GGUFFileInfo(
        root_id=root_id,
        rel_path=rel_path,
        filename=path.name,
        size_bytes=path.stat().st_size,
        architecture=architecture,
        endian=reader.endianess.name,
        metadata=metadata,
        tensor_count=len(reader.tensors),
        tensors=tensors,
        total_parameters=total_parameters,
    )


# --------------------------------------------------------------------------
# Value coercion helpers
# --------------------------------------------------------------------------


def value_type_from_name(name: str | None, *, field_desc: str) -> GGUFValueType:
    if not name:
        raise GGUFHandlerError(f"value_type is required for {field_desc}")
    try:
        return GGUFValueType[name.upper()]
    except KeyError as exc:
        raise GGUFHandlerError(f"Unknown value_type '{name}' for {field_desc}") from exc


def _coerce_scalar(value_type: GGUFValueType, raw: Any) -> Any:
    if raw is None:
        raise GGUFHandlerError("A value is required for this field")
    if value_type == GGUFValueType.STRING:
        return str(raw)
    if value_type == GGUFValueType.BOOL:
        if isinstance(raw, str):
            return raw.strip().lower() in {"1", "true", "yes", "on"}
        return bool(raw)
    if value_type in _INT_TYPES:
        return int(raw)
    if value_type in _FLOAT_TYPES:
        return float(raw)
    raise GGUFHandlerError(f"Unsupported scalar value type: {value_type.name}")


def coerce_value(value_type: GGUFValueType, sub_type: GGUFValueType | None, raw: Any) -> Any:
    if value_type == GGUFValueType.ARRAY:
        if sub_type is None:
            raise GGUFHandlerError("Array edits require an array_value_type")
        if not isinstance(raw, (list, tuple)):
            raise GGUFHandlerError("Array edits require a list value")
        return [_coerce_scalar(sub_type, item) for item in raw]
    return _coerce_scalar(value_type, raw)


# --------------------------------------------------------------------------
# Writing (edit + save-as, preserving tensor data)
# --------------------------------------------------------------------------


@dataclass
class _PlannedValue:
    value_type: GGUFValueType
    value: Any
    sub_type: GGUFValueType | None = None


def _plan_edits(edits: list[MetadataEdit]) -> tuple[dict[str, _PlannedValue], set[str], dict[str, str]]:
    """Turn API edit operations into (new/changed values, deletions, renames)."""
    sets: dict[str, _PlannedValue] = {}
    deletes: set[str] = set()
    renames: dict[str, str] = {}

    for edit in edits:
        if edit.op == EditOp.DELETE:
            deletes.add(edit.key)
            sets.pop(edit.key, None)
        elif edit.op == EditOp.RENAME:
            if not edit.new_key:
                raise GGUFHandlerError(f"Renaming '{edit.key}' requires new_key")
            renames[edit.key] = edit.new_key
        elif edit.op == EditOp.SET:
            value_type = value_type_from_name(edit.value_type, field_desc=f"key '{edit.key}'")
            sub_type = (
                value_type_from_name(edit.array_value_type, field_desc=f"key '{edit.key}' array items")
                if value_type == GGUFValueType.ARRAY
                else None
            )
            sets[edit.key] = _PlannedValue(value_type, coerce_value(value_type, sub_type, edit.value), sub_type)
        else:  # pragma: no cover - EditOp is an exhaustive enum
            raise GGUFHandlerError(f"Unsupported edit operation: {edit.op}")

    return sets, deletes, renames


def write_with_edits(input_path: Path, output_path: Path, edits: list[MetadataEdit]) -> None:
    """Write a copy of ``input_path`` to ``output_path`` with ``edits`` applied.

    Tensor data is streamed straight from the (memory-mapped) source file to
    the destination, mirroring upstream's ``gguf_new_metadata.py``, so large
    models are never fully loaded into memory.
    """
    sets, deletes, renames = _plan_edits(edits)
    reader = _open_reader(input_path)

    arch_field = reader.get_field(Keys.General.ARCHITECTURE)
    arch = arch_field.contents() if arch_field else "unknown"
    if Keys.General.ARCHITECTURE in sets:
        arch = sets.pop(Keys.General.ARCHITECTURE).value

    output_path.parent.mkdir(parents=True, exist_ok=True)
    writer = GGUFWriter(str(output_path), arch=arch, endianess=reader.endianess)

    alignment_field = reader.get_field(Keys.General.ALIGNMENT)
    if alignment_field is not None:
        writer.data_alignment = alignment_field.contents()

    try:
        for field in reader.fields.values():
            name = field.name
            if name == Keys.General.ARCHITECTURE or name.startswith(_VIRTUAL_PREFIXES):
                continue

            target_name = renames.get(name, name)
            if name in deletes or target_name in deletes:
                continue

            if target_name in sets:
                planned = sets.pop(target_name)
                writer.add_key_value(target_name, planned.value, planned.value_type, sub_type=planned.sub_type)
            else:
                main_type, sub_type = _field_value_types(field)
                writer.add_key_value(target_name, field.contents(), main_type, sub_type=sub_type)

        # Anything left in `sets` is a brand new key not present in the source file.
        for key, planned in sets.items():
            if key in deletes:
                continue
            writer.add_key_value(key, planned.value, planned.value_type, sub_type=planned.sub_type)

        for tensor in reader.tensors:
            writer.add_tensor_info(
                tensor.name, tensor.data.shape, tensor.data.dtype, tensor.data.nbytes, tensor.tensor_type
            )

        writer.write_header_to_file()
        writer.write_kv_data_to_file()
        writer.write_ti_data_to_file()

        for tensor in reader.tensors:
            writer.write_tensor_data(tensor.data, tensor_endianess=reader.endianess)
    except Exception as exc:  # noqa: BLE001 - normalize failures for the API layer
        writer.close()
        raise GGUFHandlerError(f"Failed to write GGUF file: {exc}") from exc
    else:
        writer.close()
    finally:
        # Release the source file's mmap before any caller attempts to
        # replace/overwrite it (important on Windows, harmless elsewhere).
        del reader
        gc.collect()


def backup_path_for(root_id: str, rel_path: str) -> Path:
    settings = get_settings()
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
    safe_rel = rel_path.replace("/", "__").replace("\\", "__")
    target_dir = settings.backups_path / root_id
    target_dir.mkdir(parents=True, exist_ok=True)
    return target_dir / f"{safe_rel}.{timestamp}.bak"


def default_output_filename(original_name: str) -> str:
    stem = Path(original_name).stem
    return f"{stem}-edited.gguf"


def perform_edit(
    input_path: Path,
    *,
    root_id: str,
    rel_path: str,
    edits: list[MetadataEdit],
    output: OutputOptions,
) -> tuple[Path, Path | None]:
    """Apply ``edits`` and atomically write the result.

    Returns a tuple of ``(final_output_path, backup_path)``. Writing always
    happens to a temporary file first and is only swapped into place once
    complete, so a crash mid-write never corrupts the original model.
    """
    if output.mode == OutputMode.OVERWRITE:
        final_path = input_path
    else:
        filename = (output.filename or default_output_filename(input_path.name)).strip()
        if not filename:
            filename = default_output_filename(input_path.name)
        if os.sep in filename or "/" in filename or filename in {".", ".."}:
            raise GGUFHandlerError("Output filename must not contain path separators")
        if not filename.lower().endswith(".gguf"):
            filename += ".gguf"
        final_path = input_path.parent / filename

    tmp_path = final_path.parent / f".{final_path.stem}.tmp-{uuid.uuid4().hex[:8]}.gguf"

    write_with_edits(input_path, tmp_path, edits)

    backup_path: Path | None = None
    try:
        if final_path.exists():
            if output.backup:
                backup_path = backup_path_for(root_id, rel_path)
                shutil.copy2(final_path, backup_path)
            os.replace(tmp_path, final_path)
        else:
            os.replace(tmp_path, final_path)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise

    return final_path, backup_path


# --------------------------------------------------------------------------
# Rebrand convenience helper (bulk find/replace across string metadata)
# --------------------------------------------------------------------------


# Structural/technical keys are deliberately excluded from the *default*
# rebrand scope. Their values can textually contain the search term (e.g.
# `general.architecture = "qwen2"`) but blindly rewriting them can produce a
# GGUF file llama.cpp/Ollama/LM Studio can no longer load. Callers (including
# the AI chat tool) can still target these explicitly via the `keys` param
# if they really intend to change them.
_REBRAND_EXCLUDED_KEYS = {
    Keys.General.ARCHITECTURE,
    Keys.General.ALIGNMENT,
    Keys.General.FILE_TYPE,
    Keys.General.QUANTIZATION_VERSION,
}
_REBRAND_EXCLUDED_PREFIXES = ("tokenizer.",)


def is_rebrand_safe_key(key: str, architecture: str | None) -> bool:
    """Whether ``key`` is safe to touch with a cosmetic bulk find/replace."""
    if key in _REBRAND_EXCLUDED_KEYS:
        return False
    if key.startswith(_REBRAND_EXCLUDED_PREFIXES):
        return False
    if architecture and key.startswith(f"{architecture}."):
        return False
    return True


def build_rebrand_edits(
    info: GGUFFileInfo,
    find: str,
    replace: str,
    *,
    case_sensitive: bool = False,
    keys: list[str] | None = None,
) -> list[MetadataEdit]:
    """Build SET edits for every string metadata field containing ``find``.

    By default only "brand-safe" fields (name, description, author, license,
    ...) are considered; architecture/tokenizer internals are skipped unless
    explicitly requested via ``keys`` (see :func:`is_rebrand_safe_key`).
    """
    if not find:
        raise GGUFHandlerError("`find` must not be empty")

    edits: list[MetadataEdit] = []
    explicit_keys = set(keys) if keys else None

    for item in info.metadata:
        if item.value_type != GGUFValueType.STRING.name or item.is_array:
            continue
        if explicit_keys is not None:
            if item.key not in explicit_keys:
                continue
        elif not is_rebrand_safe_key(item.key, info.architecture):
            continue
        if not isinstance(item.value, str):
            continue

        matched = (find in item.value) if case_sensitive else (find.lower() in item.value.lower())
        if not matched:
            continue

        new_value = replace_preserving_case(item.value, find, replace, case_sensitive)
        edits.append(MetadataEdit(op=EditOp.SET, key=item.key, value=new_value, value_type="STRING"))

    return edits


def replace_preserving_case(haystack: str, find: str, replace: str, case_sensitive: bool) -> str:
    if case_sensitive:
        return haystack.replace(find, replace)

    import re

    return re.sub(re.escape(find), replace, haystack, flags=re.IGNORECASE)


# --------------------------------------------------------------------------
# In-memory draft helpers (used by the chat/agentic-edit flow, which stages
# edits across a conversation before anything is written to disk)
# --------------------------------------------------------------------------


def infer_value_type(value: Any) -> tuple[str, str | None]:
    """Guess a GGUF value type from a plain Python/JSON value.

    Used when the AI assistant (or a manual "add field" action) sets a
    brand new metadata key without specifying an explicit type.
    """
    if isinstance(value, bool):
        return GGUFValueType.BOOL.name, None
    if isinstance(value, int):
        return GGUFValueType.INT32.name, None
    if isinstance(value, float):
        return GGUFValueType.FLOAT32.name, None
    if isinstance(value, str):
        return GGUFValueType.STRING.name, None
    if isinstance(value, (list, tuple)):
        sub_type = GGUFValueType.STRING.name
        if value:
            sub_type, _ = infer_value_type(value[0])
        return GGUFValueType.ARRAY.name, sub_type
    return GGUFValueType.STRING.name, None


def merge_edits(existing: list[MetadataEdit], new: list[MetadataEdit]) -> list[MetadataEdit]:
    """Merge two ordered edit lists, keeping the latest edit per key.

    This keeps a multi-turn chat session's pending changes well-formed: if
    the assistant sets ``general.name`` twice in the same conversation, only
    the final value is kept (in its original position in the sequence).
    """
    merged: dict[str, MetadataEdit] = {}
    order: list[str] = []

    for edit in (*existing, *new):
        if edit.key not in merged:
            order.append(edit.key)
        merged[edit.key] = edit

    return [merged[key] for key in order]


def apply_edits_in_memory(metadata: list[MetadataItem], edits: list[MetadataEdit]) -> list[MetadataItem]:
    """Compute the effective metadata list after applying ``edits`` in memory.

    This never touches disk; it powers the live preview shown in the editor
    while an AI chat session (or manual edit) is still a draft.
    """
    items: dict[str, MetadataItem] = {item.key: item for item in metadata}
    order: list[str] = [item.key for item in metadata]

    for edit in edits:
        if edit.op == EditOp.DELETE:
            items.pop(edit.key, None)
            if edit.key in order:
                order.remove(edit.key)
        elif edit.op == EditOp.RENAME:
            existing = items.pop(edit.key, None)
            if existing is not None and edit.new_key:
                renamed = existing.model_copy(update={"key": edit.new_key, "modified": True})
                items[edit.new_key] = renamed
                order[order.index(edit.key)] = edit.new_key
        elif edit.op == EditOp.SET:
            prior = items.get(edit.key)
            value_type = edit.value_type or (prior.value_type if prior else infer_value_type(edit.value)[0])
            array_value_type = edit.array_value_type or (prior.array_value_type if prior else None)
            is_array = value_type == GGUFValueType.ARRAY.name
            if is_array and not array_value_type:
                array_value_type = infer_value_type(edit.value)[1]
            items[edit.key] = MetadataItem(
                key=edit.key,
                value=edit.value,
                value_type=value_type,
                array_value_type=array_value_type,
                is_array=is_array,
                array_length=len(edit.value) if is_array and isinstance(edit.value, list) else None,
                truncated=False,
                editable=True,
                modified=True,
            )
            if edit.key not in order:
                order.append(edit.key)

    return [items[key] for key in order if key in items]
