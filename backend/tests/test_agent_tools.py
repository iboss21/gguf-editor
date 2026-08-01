"""Tests for app.core.agent_tools: the tool schema and tool-call execution
that power the agentic chat / auto-edit feature."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.core import agent_tools, gguf_handler
from app.core.agent_tools import ToolContext


@pytest.fixture
def ctx(sample_gguf: Path) -> ToolContext:
    info = gguf_handler.inspect_file(sample_gguf, "root1", "sample.gguf")
    return ToolContext(info=info)


async def test_set_metadata_stages_an_edit(ctx: ToolContext) -> None:
    result = await agent_tools.execute_tool_call(ctx, "set_metadata", {"key": "general.name", "value": "Reges"})

    assert "general.name" in result
    effective = {m.key: m for m in ctx.effective_metadata()}
    assert effective["general.name"].value == "Reges"
    assert effective["general.name"].modified is True


async def test_set_metadata_infers_type_from_existing_field(ctx: ToolContext) -> None:
    await agent_tools.execute_tool_call(ctx, "set_metadata", {"key": "qwen2.block_count", "value": 4})
    effective = {m.key: m for m in ctx.effective_metadata()}
    assert effective["qwen2.block_count"].value == 4
    assert effective["qwen2.block_count"].value_type == "UINT32"


async def test_set_metadata_missing_value_returns_error_message(ctx: ToolContext) -> None:
    result = await agent_tools.execute_tool_call(ctx, "set_metadata", {"key": "general.name"})
    assert "required" in result.lower()
    assert ctx.edits == []


async def test_delete_metadata(ctx: ToolContext) -> None:
    await agent_tools.execute_tool_call(ctx, "delete_metadata", {"key": "general.license"})
    keys = {m.key for m in ctx.effective_metadata()}
    assert "general.license" not in keys


async def test_rename_metadata_key(ctx: ToolContext) -> None:
    await agent_tools.execute_tool_call(
        ctx, "rename_metadata_key", {"old_key": "general.license", "new_key": "general.custom_license"}
    )
    keys = {m.key for m in ctx.effective_metadata()}
    assert "general.license" not in keys
    assert "general.custom_license" in keys


async def test_bulk_rebrand_updates_brand_safe_fields_only(ctx: ToolContext) -> None:
    result = await agent_tools.execute_tool_call(ctx, "bulk_rebrand", {"find": "Qwen", "replace": "Reges"})

    assert "Rebranded" in result
    effective = {m.key: m for m in ctx.effective_metadata()}
    assert effective["general.name"].value == "Reges2-Test-7B"
    # Architecture must never be silently rebranded.
    assert effective["general.architecture"].value == "qwen2"


async def test_bulk_rebrand_no_match_reports_no_changes(ctx: ToolContext) -> None:
    result = await agent_tools.execute_tool_call(ctx, "bulk_rebrand", {"find": "NoSuchTerm", "replace": "X"})
    assert "no" in result.lower()
    assert ctx.edits == []


async def test_set_output_filename(ctx: ToolContext) -> None:
    await agent_tools.execute_tool_call(ctx, "set_output_filename", {"filename": "reges.gguf"})
    assert ctx.output_filename == "reges.gguf"


async def test_unknown_tool_returns_message_without_raising(ctx: ToolContext) -> None:
    result = await agent_tools.execute_tool_call(ctx, "not_a_real_tool", {})
    assert "unknown tool" in result.lower()


def test_tool_context_merge_edits_last_write_wins(ctx: ToolContext) -> None:
    from app.models.schemas import EditOp, MetadataEdit

    ctx.merge_edits([MetadataEdit(op=EditOp.SET, key="general.name", value="A", value_type="STRING")])
    ctx.merge_edits([MetadataEdit(op=EditOp.SET, key="general.name", value="B", value_type="STRING")])

    assert len(ctx.edits) == 1
    assert ctx.edits[0].value == "B"


def test_build_system_prompt_mentions_filename_and_architecture(sample_gguf: Path) -> None:
    info = gguf_handler.inspect_file(sample_gguf, "root1", "sample.gguf")
    prompt = agent_tools.build_system_prompt(info, info.metadata)

    assert "sample.gguf" in prompt
    assert "qwen2" in prompt
    assert "general.name" in prompt


def test_tools_schema_has_expected_tool_names() -> None:
    names = {t["name"] for t in agent_tools.TOOLS}
    assert names == {
        "set_metadata",
        "delete_metadata",
        "rename_metadata_key",
        "bulk_rebrand",
        "set_output_filename",
    }
