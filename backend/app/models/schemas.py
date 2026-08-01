"""Pydantic models shared across the API layer.

These models are the single source of truth for the JSON contract between
the FastAPI backend and the Next.js frontend.
"""
from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field

# --------------------------------------------------------------------------
# Explorer / file system
# --------------------------------------------------------------------------


class RootCreate(BaseModel):
    path: str
    label: str | None = None


class RootInfo(BaseModel):
    id: str
    label: str
    path: str
    exists: bool
    created_at: str


class EntryInfo(BaseModel):
    name: str
    rel_path: str
    is_dir: bool
    is_gguf: bool
    size_bytes: int | None = None
    modified_at: str | None = None


class DirectoryListing(BaseModel):
    root_id: str
    rel_path: str
    parent_rel_path: str | None = None
    entries: list[EntryInfo]


class SearchResult(BaseModel):
    root_id: str
    query: str
    results: list[EntryInfo]


# --------------------------------------------------------------------------
# GGUF metadata / tensors
# --------------------------------------------------------------------------


class MetadataItem(BaseModel):
    key: str
    value: Any = None
    value_type: str
    array_value_type: str | None = None
    is_array: bool = False
    array_length: int | None = None
    truncated: bool = False
    editable: bool = True
    modified: bool = False


class TensorItem(BaseModel):
    name: str
    shape: list[int]
    dtype: str
    n_elements: int


class GGUFFileInfo(BaseModel):
    root_id: str
    rel_path: str
    filename: str
    size_bytes: int
    architecture: str | None = None
    endian: str
    metadata: list[MetadataItem]
    tensor_count: int
    tensors: list[TensorItem]
    total_parameters: int | None = None


class InspectRequest(BaseModel):
    root_id: str
    rel_path: str


class EditOp(StrEnum):
    SET = "set"
    DELETE = "delete"
    RENAME = "rename"


class MetadataEdit(BaseModel):
    op: EditOp
    key: str
    value: Any = None
    value_type: str | None = None
    array_value_type: str | None = None
    new_key: str | None = None


class OutputMode(StrEnum):
    OVERWRITE = "overwrite"
    NEW_NAME = "new_name"


class OutputOptions(BaseModel):
    mode: OutputMode = OutputMode.NEW_NAME
    filename: str | None = None
    backup: bool = True


class ApplyEditsRequest(BaseModel):
    root_id: str
    rel_path: str
    edits: list[MetadataEdit]
    output: OutputOptions = Field(default_factory=OutputOptions)


class ApplyEditsResponse(BaseModel):
    success: bool
    output_rel_path: str
    backup_rel_path: str | None = None
    file: GGUFFileInfo


class RebrandRequest(BaseModel):
    root_id: str
    rel_path: str
    find: str
    replace: str
    case_sensitive: bool = False
    include_filename: bool = True
    keys: list[str] | None = None
    output: OutputOptions = Field(default_factory=OutputOptions)


# --------------------------------------------------------------------------
# Providers (Local / Global / BYOK)
# --------------------------------------------------------------------------


class ProviderScope(StrEnum):
    LOCAL = "local"
    GLOBAL = "global"
    BYOK = "byok"


class ProviderKind(StrEnum):
    OPENAI_COMPATIBLE = "openai_compatible"
    ANTHROPIC = "anthropic"


class ProviderCreate(BaseModel):
    name: str
    kind: ProviderKind
    scope: ProviderScope
    base_url: str
    api_key: str | None = None
    model: str | None = None


class ProviderUpdate(BaseModel):
    name: str | None = None
    base_url: str | None = None
    api_key: str | None = None
    clear_api_key: bool = False
    model: str | None = None


class ProviderPublic(BaseModel):
    id: str
    name: str
    kind: ProviderKind
    scope: ProviderScope
    base_url: str
    model: str | None = None
    has_api_key: bool
    created_at: str
    updated_at: str


class ProviderTestResult(BaseModel):
    ok: bool
    detail: str
    models: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------
# Chat / agentic auto-edit
# --------------------------------------------------------------------------


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


class ChatTarget(BaseModel):
    root_id: str
    rel_path: str


class ChatRequest(BaseModel):
    provider_id: str
    messages: list[ChatMessage]
    target: ChatTarget | None = None
    pending_edits: list[MetadataEdit] = Field(default_factory=list)
    auto_apply: bool = False


class ToolEvent(BaseModel):
    tool: str
    args: dict[str, Any]
    result: str


class ChatResponse(BaseModel):
    message: ChatMessage
    tool_events: list[ToolEvent]
    pending_edits: list[MetadataEdit]
    metadata_preview: list[MetadataItem] = Field(default_factory=list)
    applied: bool = False
    output_rel_path: str | None = None
