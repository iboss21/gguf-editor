"""Tests for app.core.gguf_handler: reading, editing, rebranding, and the
atomic write path."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.core import gguf_handler
from app.models.schemas import EditOp, MetadataEdit, OutputMode, OutputOptions


def test_inspect_file_reads_metadata_and_tensors(sample_gguf: Path) -> None:
    info = gguf_handler.inspect_file(sample_gguf, "root1", "sample.gguf")

    assert info.architecture == "qwen2"
    assert info.filename == "sample.gguf"
    assert info.tensor_count == 1
    assert info.total_parameters == 2048
    assert info.tensors[0].name == "token_embd.weight"
    assert info.tensors[0].n_elements == 2048

    by_key = {m.key: m for m in info.metadata}
    assert by_key["general.name"].value == "Qwen2-Test-7B"
    assert by_key["general.architecture"].value == "qwen2"
    assert by_key["test.tags"].value == ["qwen", "chat", "test"]
    assert by_key["test.tags"].is_array is True
    # GGUF.* housekeeping fields are surfaced too, for transparency.
    assert "GGUF.version" in by_key


def test_inspect_file_missing_raises_handler_error(tmp_path: Path) -> None:
    with pytest.raises(gguf_handler.GGUFHandlerError):
        gguf_handler.inspect_file(tmp_path / "does-not-exist.gguf", "root1", "does-not-exist.gguf")


# --------------------------------------------------------------------------
# is_rebrand_safe_key / build_rebrand_edits
# --------------------------------------------------------------------------


def test_is_rebrand_safe_key_excludes_structural_fields() -> None:
    assert gguf_handler.is_rebrand_safe_key("general.name", "qwen2") is True
    assert gguf_handler.is_rebrand_safe_key("general.description", "qwen2") is True
    assert gguf_handler.is_rebrand_safe_key("general.architecture", "qwen2") is False
    assert gguf_handler.is_rebrand_safe_key("general.alignment", "qwen2") is False
    assert gguf_handler.is_rebrand_safe_key("general.file_type", "qwen2") is False
    assert gguf_handler.is_rebrand_safe_key("general.quantization_version", "qwen2") is False
    assert gguf_handler.is_rebrand_safe_key("tokenizer.ggml.model", "qwen2") is False
    assert gguf_handler.is_rebrand_safe_key("qwen2.context_length", "qwen2") is False


def test_build_rebrand_edits_never_touches_architecture(sample_gguf: Path) -> None:
    info = gguf_handler.inspect_file(sample_gguf, "root1", "sample.gguf")
    edits = gguf_handler.build_rebrand_edits(info, "Qwen", "Reges")

    edited_keys = {e.key for e in edits}
    assert "general.architecture" not in edited_keys
    assert "qwen2.context_length" not in edited_keys
    assert "general.name" in edited_keys
    assert "general.description" in edited_keys

    name_edit = next(e for e in edits if e.key == "general.name")
    assert name_edit.value == "Reges2-Test-7B"


def test_build_rebrand_edits_explicit_keys_can_override_architecture(sample_gguf: Path) -> None:
    info = gguf_handler.inspect_file(sample_gguf, "root1", "sample.gguf")
    edits = gguf_handler.build_rebrand_edits(info, "qwen2", "reges2", keys=["general.architecture"])

    assert len(edits) == 1
    assert edits[0].key == "general.architecture"
    assert edits[0].value == "reges2"


def test_build_rebrand_edits_empty_find_raises(sample_gguf: Path) -> None:
    info = gguf_handler.inspect_file(sample_gguf, "root1", "sample.gguf")
    with pytest.raises(gguf_handler.GGUFHandlerError):
        gguf_handler.build_rebrand_edits(info, "", "x")


def test_build_rebrand_edits_no_match_returns_empty(sample_gguf: Path) -> None:
    info = gguf_handler.inspect_file(sample_gguf, "root1", "sample.gguf")
    edits = gguf_handler.build_rebrand_edits(info, "NoSuchTerm", "X")
    assert edits == []


# --------------------------------------------------------------------------
# perform_edit / write_with_edits (atomic write, preserves tensors)
# --------------------------------------------------------------------------


def test_perform_edit_new_name_preserves_tensors_and_applies_edits(sample_gguf: Path) -> None:
    edits = [MetadataEdit(op=EditOp.SET, key="general.name", value="Reges-Test-7B", value_type="STRING")]
    output = OutputOptions(mode=OutputMode.NEW_NAME, filename="reges.gguf", backup=False)

    final_path, backup_path = gguf_handler.perform_edit(
        sample_gguf, root_id="root1", rel_path="sample.gguf", edits=edits, output=output
    )

    assert backup_path is None
    assert final_path.name == "reges.gguf"
    assert sample_gguf.exists()  # original untouched in new_name mode

    original = gguf_handler.inspect_file(sample_gguf, "root1", "sample.gguf")
    edited = gguf_handler.inspect_file(final_path, "root1", "reges.gguf")

    assert edited.architecture == "qwen2"
    edited_name = next(m for m in edited.metadata if m.key == "general.name")
    assert edited_name.value == "Reges-Test-7B"

    # Tensor data must be preserved byte-for-byte.
    assert edited.tensor_count == original.tensor_count
    assert edited.total_parameters == original.total_parameters
    assert [t.shape for t in edited.tensors] == [t.shape for t in original.tensors]
    assert [t.dtype for t in edited.tensors] == [t.dtype for t in original.tensors]


def test_perform_edit_overwrite_with_backup(sample_gguf: Path) -> None:
    edits = [MetadataEdit(op=EditOp.DELETE, key="test.tags")]
    output = OutputOptions(mode=OutputMode.OVERWRITE, backup=True)

    final_path, backup_path = gguf_handler.perform_edit(
        sample_gguf, root_id="root1", rel_path="sample.gguf", edits=edits, output=output
    )

    assert final_path == sample_gguf
    assert backup_path is not None
    assert backup_path.exists()

    # The backup holds the pre-edit content (tags still present).
    backup_info = gguf_handler.inspect_file(backup_path, "root1", backup_path.name)
    assert any(m.key == "test.tags" for m in backup_info.metadata)

    # The overwritten file no longer has the deleted key.
    edited_info = gguf_handler.inspect_file(sample_gguf, "root1", "sample.gguf")
    assert not any(m.key == "test.tags" for m in edited_info.metadata)


def test_perform_edit_rename_key(sample_gguf: Path) -> None:
    edits = [MetadataEdit(op=EditOp.RENAME, key="general.license", new_key="general.custom_license")]
    output = OutputOptions(mode=OutputMode.OVERWRITE, backup=False)

    final_path, _ = gguf_handler.perform_edit(
        sample_gguf, root_id="root1", rel_path="sample.gguf", edits=edits, output=output
    )

    info = gguf_handler.inspect_file(final_path, "root1", "sample.gguf")
    keys = {m.key for m in info.metadata}
    assert "general.license" not in keys
    assert "general.custom_license" in keys


def test_perform_edit_output_filename_rejects_path_separators(sample_gguf: Path) -> None:
    edits = [MetadataEdit(op=EditOp.SET, key="general.name", value="X", value_type="STRING")]
    output = OutputOptions(mode=OutputMode.NEW_NAME, filename="../evil.gguf", backup=False)

    with pytest.raises(gguf_handler.GGUFHandlerError):
        gguf_handler.perform_edit(sample_gguf, root_id="root1", rel_path="sample.gguf", edits=edits, output=output)


def test_default_output_filename() -> None:
    assert gguf_handler.default_output_filename("model.gguf") == "model-edited.gguf"


# --------------------------------------------------------------------------
# In-memory draft helpers used by the chat/agentic-edit flow
# --------------------------------------------------------------------------


def test_merge_edits_keeps_last_write_per_key() -> None:
    existing = [MetadataEdit(op=EditOp.SET, key="general.name", value="A", value_type="STRING")]
    new = [
        MetadataEdit(op=EditOp.SET, key="general.name", value="B", value_type="STRING"),
        MetadataEdit(op=EditOp.SET, key="general.license", value="mit", value_type="STRING"),
    ]

    merged = gguf_handler.merge_edits(existing, new)

    assert [e.key for e in merged] == ["general.name", "general.license"]
    assert next(e for e in merged if e.key == "general.name").value == "B"


def test_apply_edits_in_memory_set_delete_rename(sample_gguf: Path) -> None:
    info = gguf_handler.inspect_file(sample_gguf, "root1", "sample.gguf")
    edits = [
        MetadataEdit(op=EditOp.SET, key="general.name", value="Reges", value_type="STRING"),
        MetadataEdit(op=EditOp.DELETE, key="general.license"),
        MetadataEdit(op=EditOp.RENAME, key="general.description", new_key="general.summary"),
    ]

    preview = gguf_handler.apply_edits_in_memory(info.metadata, edits)
    by_key = {m.key: m for m in preview}

    assert by_key["general.name"].value == "Reges"
    assert by_key["general.name"].modified is True
    assert "general.license" not in by_key
    assert "general.description" not in by_key
    assert by_key["general.summary"].modified is True
    # Untouched fields keep modified=False.
    assert by_key["general.architecture"].modified is False


def test_infer_value_type() -> None:
    assert gguf_handler.infer_value_type(True)[0] == "BOOL"
    assert gguf_handler.infer_value_type(5)[0] == "INT32"
    assert gguf_handler.infer_value_type(1.5)[0] == "FLOAT32"
    assert gguf_handler.infer_value_type("x")[0] == "STRING"
    assert gguf_handler.infer_value_type(["a", "b"]) == ("ARRAY", "STRING")
