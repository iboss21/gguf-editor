"""Agentic chat endpoint: routes a conversation to the selected LLM provider,
letting it call GGUF-editing tools that stage (or, with auto-apply, write)
metadata changes.
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.api.deps import resolve_gguf_path
from app.config import get_settings
from app.core import agent_tools, fs_handler, gguf_handler, providers_repo
from app.core.llm_providers import LLMProviderError, build_client
from app.models.schemas import (
    ChatMessage,
    ChatRequest,
    ChatResponse,
    OutputOptions,
)

router = APIRouter()


@router.post("", response_model=ChatResponse)
async def chat(payload: ChatRequest) -> ChatResponse:
    if not payload.messages:
        raise HTTPException(status_code=400, detail="At least one message is required")

    try:
        provider = providers_repo.get_provider(payload.provider_id)
    except providers_repo.ProviderNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown provider_id '{payload.provider_id}'") from exc

    settings = get_settings()
    client = build_client(
        kind=provider.kind,
        base_url=provider.base_url,
        api_key=provider.api_key,
        model=provider.model,
        timeout=settings.llm_request_timeout,
    )

    if payload.target is not None:
        root, path = resolve_gguf_path(payload.target.root_id, payload.target.rel_path)
        target_root_id, target_rel_path = payload.target.root_id, payload.target.rel_path
        info = gguf_handler.inspect_file(path, target_root_id, target_rel_path)
        ctx = agent_tools.ToolContext(info=info, edits=list(payload.pending_edits))
        system_prompt = agent_tools.build_system_prompt(info, ctx.effective_metadata())
        tools = agent_tools.TOOLS
    else:
        root = None
        path = None
        target_root_id = None
        target_rel_path = None
        ctx = None
        system_prompt = (
            "You are the AI assistant embedded in GGUF Editor. No GGUF file is currently open, "
            "so you cannot make metadata edits yet - ask the user to select a file in the Explorer "
            "tab first, or answer general questions about GGUF files."
        )
        tools = []

    async def tool_executor(name: str, args: dict) -> str:
        if ctx is None:
            return "No file is open, so no edit tools are available right now."
        return await agent_tools.execute_tool_call(ctx, name, args)

    try:
        result = await client.run_conversation(
            system_prompt=system_prompt,
            messages=payload.messages,
            tools=tools,
            tool_executor=tool_executor,
        )
    except LLMProviderError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    pending_edits = ctx.edits if ctx else []
    metadata_preview = ctx.effective_metadata() if ctx else []
    applied = False
    output_rel_path = None

    if payload.auto_apply and ctx is not None and pending_edits and path is not None and root is not None:
        output = OutputOptions(filename=ctx.output_filename) if ctx.output_filename else OutputOptions()
        try:
            final_path, _backup = gguf_handler.perform_edit(
                path,
                root_id=target_root_id,
                rel_path=target_rel_path,
                edits=pending_edits,
                output=output,
            )
            output_rel_path = fs_handler.relative_to_root(final_path, root)
            applied = True
            pending_edits = []
        except gguf_handler.GGUFHandlerError as exc:
            result.text += f"\n\n(Note: I couldn't automatically save the file - {exc})"

    return ChatResponse(
        message=ChatMessage(role="assistant", content=result.text or "Done."),
        tool_events=result.tool_events,
        pending_edits=pending_edits,
        metadata_preview=metadata_preview,
        applied=applied,
        output_rel_path=output_rel_path,
    )
