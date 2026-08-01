"""LLM provider adapters powering the agentic chat / auto-edit feature.

Two provider "kinds" are supported, which together cover Local, Global and
BYOK usage described in the product brief:

* ``openai_compatible`` - the OpenAI Chat Completions API shape. This
  covers OpenAI itself, Groq, and most local runtimes (Ollama's OpenAI
  compatible endpoint, LM Studio, text-generation-webui, vLLM, ...).
* ``anthropic`` - Anthropic's native Messages API (Claude models).

Both adapters implement the same small interface so ``routes_chat.py`` can
stay provider-agnostic: :meth:`run_conversation` drives the full tool-calling
loop for a single user turn and returns the final assistant text together
with a flat list of tool invocations that were executed along the way.
"""
from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

from app.models.schemas import ChatMessage, ProviderKind, ToolEvent

logger = logging.getLogger("gguf_editor.llm")

# A tool executor receives (tool_name, arguments) and returns a short text
# result that is fed back to the model as the "tool result" message.
ToolExecutor = Callable[[str, dict[str, Any]], Awaitable[str]]

MAX_TOOL_ITERATIONS = 6

_ANTHROPIC_FALLBACK_MODELS = [
    "claude-3-5-sonnet-latest",
    "claude-3-5-haiku-latest",
    "claude-3-opus-latest",
]


class LLMProviderError(Exception):
    """Raised when a provider call fails outright (network, auth, bad response)."""


@dataclass
class ConversationResult:
    text: str
    tool_events: list[ToolEvent] = field(default_factory=list)


class BaseLLMClient:
    kind: ProviderKind

    def __init__(self, *, base_url: str, api_key: str | None, model: str | None, timeout: float):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self.timeout = timeout

    async def run_conversation(
        self,
        *,
        system_prompt: str,
        messages: list[ChatMessage],
        tools: list[dict[str, Any]],
        tool_executor: ToolExecutor,
    ) -> ConversationResult:
        raise NotImplementedError

    async def list_models(self) -> list[str]:
        raise NotImplementedError

    async def test_connection(self) -> tuple[bool, str, list[str]]:
        try:
            models = await self.list_models()
        except Exception as exc:  # noqa: BLE001 - surfaced to the user as a plain message
            return False, str(exc), []
        detail = f"Connected successfully. {len(models)} model(s) reported." if models else "Connected successfully."
        return True, detail, models


class OpenAICompatibleClient(BaseLLMClient):
    """OpenAI Chat Completions compatible client (OpenAI, Groq, Ollama, LM Studio, ...)."""

    kind = ProviderKind.OPENAI_COMPATIBLE

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            bearer_prefix = "Bearer"
            headers["Authorization"] = bearer_prefix + " " + self.api_key
        return headers

    async def list_models(self) -> list[str]:
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(f"{self.base_url}/models", headers=self._headers())
            resp.raise_for_status()
            data = resp.json()
        return [m.get("id", "") for m in data.get("data", []) if m.get("id")]

    @staticmethod
    def _to_openai_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [{"type": "function", "function": t} for t in tools]

    async def run_conversation(
        self,
        *,
        system_prompt: str,
        messages: list[ChatMessage],
        tools: list[dict[str, Any]],
        tool_executor: ToolExecutor,
    ) -> ConversationResult:
        oa_messages: list[dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        oa_messages.extend({"role": m.role, "content": m.content} for m in messages)
        oa_tools = self._to_openai_tools(tools)
        tool_events: list[ToolEvent] = []

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for _ in range(MAX_TOOL_ITERATIONS):
                payload: dict[str, Any] = {"model": self.model, "messages": oa_messages}
                if oa_tools:
                    payload["tools"] = oa_tools
                    payload["tool_choice"] = "auto"

                try:
                    resp = await client.post(f"{self.base_url}/chat/completions", headers=self._headers(), json=payload)
                    resp.raise_for_status()
                except httpx.HTTPError as exc:
                    raise LLMProviderError(f"Provider request failed: {exc}") from exc

                data = resp.json()
                choices = data.get("choices") or []
                if not choices:
                    raise LLMProviderError("Provider returned no choices in its response")

                message = choices[0].get("message", {}) or {}
                tool_calls = message.get("tool_calls") or []

                if not tool_calls:
                    return ConversationResult(text=message.get("content") or "", tool_events=tool_events)

                oa_messages.append(message)
                for call in tool_calls:
                    fn = call.get("function", {}) or {}
                    name = fn.get("name", "")
                    args = _safe_json_loads(fn.get("arguments"))
                    result = await tool_executor(name, args)
                    tool_events.append(ToolEvent(tool=name, args=args, result=result))
                    oa_messages.append({"role": "tool", "tool_call_id": call.get("id", ""), "content": result})

        return _tool_limit_result(tool_events)


class AnthropicClient(BaseLLMClient):
    """Anthropic Messages API client (Claude models)."""

    kind = ProviderKind.ANTHROPIC
    api_version = "2023-06-01"
    max_tokens = 4096

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "x-api-key": self.api_key or "",
            "anthropic-version": self.api_version,
        }

    async def list_models(self) -> list[str]:
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.get(f"{self.base_url}/v1/models", headers=self._headers())
                resp.raise_for_status()
                data = resp.json()
            models = [m.get("id", "") for m in data.get("data", []) if m.get("id")]
            return models or list(_ANTHROPIC_FALLBACK_MODELS)
        except httpx.HTTPError:
            return list(_ANTHROPIC_FALLBACK_MODELS)

    @staticmethod
    def _to_anthropic_tools(tools: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [
            {"name": t["name"], "description": t.get("description", ""), "input_schema": t.get("parameters", {})}
            for t in tools
        ]

    async def run_conversation(
        self,
        *,
        system_prompt: str,
        messages: list[ChatMessage],
        tools: list[dict[str, Any]],
        tool_executor: ToolExecutor,
    ) -> ConversationResult:
        anthropic_messages: list[dict[str, Any]] = [
            {"role": m.role, "content": m.content} for m in messages if m.role != "system"
        ]
        anthropic_tools = self._to_anthropic_tools(tools)
        tool_events: list[ToolEvent] = []

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            for _ in range(MAX_TOOL_ITERATIONS):
                payload: dict[str, Any] = {
                    "model": self.model,
                    "max_tokens": self.max_tokens,
                    "system": system_prompt,
                    "messages": anthropic_messages,
                }
                if anthropic_tools:
                    payload["tools"] = anthropic_tools

                try:
                    resp = await client.post(f"{self.base_url}/v1/messages", headers=self._headers(), json=payload)
                    resp.raise_for_status()
                except httpx.HTTPError as exc:
                    raise LLMProviderError(f"Provider request failed: {exc}") from exc

                data = resp.json()
                content_blocks = data.get("content") or []
                text_parts = [b.get("text", "") for b in content_blocks if b.get("type") == "text"]
                tool_use_blocks = [b for b in content_blocks if b.get("type") == "tool_use"]

                if not tool_use_blocks:
                    return ConversationResult(text="\n".join(text_parts).strip(), tool_events=tool_events)

                anthropic_messages.append({"role": "assistant", "content": content_blocks})

                tool_results = []
                for block in tool_use_blocks:
                    name = block.get("name", "")
                    args = block.get("input") or {}
                    result = await tool_executor(name, args)
                    tool_events.append(ToolEvent(tool=name, args=args, result=result))
                    tool_results.append(
                        {"type": "tool_result", "tool_use_id": block.get("id", ""), "content": result}
                    )
                anthropic_messages.append({"role": "user", "content": tool_results})

        return _tool_limit_result(tool_events)


def _safe_json_loads(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, dict) else {}
    except (json.JSONDecodeError, TypeError):
        logger.warning("Failed to parse tool call arguments: %r", raw)
        return {}


def _tool_limit_result(tool_events: list[ToolEvent]) -> ConversationResult:
    return ConversationResult(
        text=(
            "I made several edits but reached the tool-call limit for this turn. "
            "Review the pending changes below, or ask me to continue."
        ),
        tool_events=tool_events,
    )


def build_client(
    *, kind: ProviderKind, base_url: str, api_key: str | None, model: str | None, timeout: float
) -> BaseLLMClient:
    if kind == ProviderKind.ANTHROPIC:
        return AnthropicClient(base_url=base_url, api_key=api_key, model=model, timeout=timeout)
    if kind == ProviderKind.OPENAI_COMPATIBLE:
        return OpenAICompatibleClient(base_url=base_url, api_key=api_key, model=model, timeout=timeout)
    raise ValueError(f"Unsupported provider kind: {kind}")
