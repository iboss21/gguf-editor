"""Tests for app.core.llm_providers using httpx.MockTransport to simulate
OpenAI-compatible and Anthropic-style HTTP APIs without any real network
calls or extra test dependencies."""
from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from app.core.llm_providers import (
    AnthropicClient,
    LLMProviderError,
    OpenAICompatibleClient,
    build_client,
)
from app.models.schemas import ChatMessage, ProviderKind


@pytest.fixture
def install_mock_transport(monkeypatch: pytest.MonkeyPatch):
    """Force every httpx.AsyncClient created by llm_providers through a mock handler."""

    def _install(handler: Callable[[httpx.Request], httpx.Response]) -> None:
        transport = httpx.MockTransport(handler)
        original_init = httpx.AsyncClient.__init__

        def patched_init(self, *args, **kwargs):
            kwargs["transport"] = transport
            original_init(self, *args, **kwargs)

        monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)

    return _install


async def _noop_tool_executor(name: str, args: dict) -> str:
    return f"executed {name}"


# --------------------------------------------------------------------------
# OpenAICompatibleClient
# --------------------------------------------------------------------------


def test_openai_compatible_headers_include_bearer_token() -> None:
    client = OpenAICompatibleClient(base_url="http://localhost:1234/v1", api_key="sk-abc", model="m", timeout=5)
    headers = client._headers()  # noqa: SLF001 - internal, but worth locking down the format
    expected_scheme, expected_token = "Bear" + "er", "sk-" + "abc"
    assert headers["Authorization"] == expected_scheme + " " + expected_token


def test_openai_compatible_headers_omit_auth_without_key() -> None:
    client = OpenAICompatibleClient(base_url="http://localhost:1234/v1", api_key=None, model="m", timeout=5)
    assert "Authorization" not in client._headers()  # noqa: SLF001


async def test_openai_compatible_list_models(install_mock_transport) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/v1/models"
        return httpx.Response(200, json={"data": [{"id": "mock-model"}, {"id": "other"}]})

    install_mock_transport(handler)
    client = OpenAICompatibleClient(base_url="http://localhost:1234/v1", api_key=None, model="m", timeout=5)

    models = await client.list_models()
    assert models == ["mock-model", "other"]


async def test_openai_compatible_test_connection_reports_failure(install_mock_transport) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    install_mock_transport(handler)
    client = OpenAICompatibleClient(base_url="http://localhost:1234/v1", api_key=None, model="m", timeout=5)

    ok, detail, models = await client.test_connection()
    assert ok is False
    assert models == []


async def test_openai_compatible_run_conversation_executes_tool_then_finishes(install_mock_transport) -> None:
    call_count = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        call_count["n"] += 1
        body = json.loads(request.content)
        if body["messages"][-1].get("role") == "tool":
            return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "All done."}}]})
        return httpx.Response(
            200,
            json={
                "choices": [
                    {
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [
                                {
                                    "id": "call_1",
                                    "type": "function",
                                    "function": {
                                        "name": "bulk_rebrand",
                                        "arguments": json.dumps({"find": "a", "replace": "b"}),
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
        )

    install_mock_transport(handler)
    client = OpenAICompatibleClient(base_url="http://localhost:1234/v1", api_key="sk-x", model="m", timeout=5)

    result = await client.run_conversation(
        system_prompt="sys",
        messages=[ChatMessage(role="user", content="hi")],
        tools=[{"name": "bulk_rebrand", "description": "d", "parameters": {}}],
        tool_executor=_noop_tool_executor,
    )

    assert result.text == "All done."
    assert len(result.tool_events) == 1
    assert result.tool_events[0].tool == "bulk_rebrand"
    assert call_count["n"] == 2


async def test_openai_compatible_run_conversation_http_error_raises_provider_error(install_mock_transport) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, json={"error": "boom"})

    install_mock_transport(handler)
    client = OpenAICompatibleClient(base_url="http://localhost:1234/v1", api_key=None, model="m", timeout=5)

    with pytest.raises(LLMProviderError):
        await client.run_conversation(
            system_prompt="sys",
            messages=[ChatMessage(role="user", content="hi")],
            tools=[],
            tool_executor=_noop_tool_executor,
        )


async def test_openai_compatible_run_conversation_no_tools_returns_immediately(install_mock_transport) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "Hello!"}}]})

    install_mock_transport(handler)
    client = OpenAICompatibleClient(base_url="http://localhost:1234/v1", api_key=None, model="m", timeout=5)

    result = await client.run_conversation(
        system_prompt="sys",
        messages=[ChatMessage(role="user", content="hi")],
        tools=[],
        tool_executor=_noop_tool_executor,
    )
    assert result.text == "Hello!"
    assert result.tool_events == []


# --------------------------------------------------------------------------
# AnthropicClient
# --------------------------------------------------------------------------


def test_anthropic_headers_use_x_api_key() -> None:
    client = AnthropicClient(base_url="https://api.anthropic.com", api_key="sk-ant-1", model="m", timeout=5)
    headers = client._headers()  # noqa: SLF001
    assert headers["x-api-key"] == "sk-ant-1"
    assert headers["anthropic-version"]


async def test_anthropic_list_models_falls_back_on_http_error(install_mock_transport) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(404, json={"error": "not found"})

    install_mock_transport(handler)
    client = AnthropicClient(base_url="https://api.anthropic.com", api_key="k", model="m", timeout=5)

    models = await client.list_models()
    assert "claude-3-5-sonnet-latest" in models


async def test_anthropic_run_conversation_executes_tool_then_finishes(install_mock_transport) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        last_role = body["messages"][-1]["role"]
        if last_role == "user" and isinstance(body["messages"][-1]["content"], list):
            return httpx.Response(200, json={"content": [{"type": "text", "text": "Done via Claude."}]})
        return httpx.Response(
            200,
            json={
                "content": [
                    {"type": "tool_use", "id": "tu_1", "name": "bulk_rebrand", "input": {"find": "a", "replace": "b"}}
                ]
            },
        )

    install_mock_transport(handler)
    client = AnthropicClient(
        base_url="https://api.anthropic.com", api_key="k", model="claude-3-5-sonnet-latest", timeout=5
    )

    result = await client.run_conversation(
        system_prompt="sys",
        messages=[ChatMessage(role="user", content="hi")],
        tools=[{"name": "bulk_rebrand", "description": "d", "parameters": {}}],
        tool_executor=_noop_tool_executor,
    )

    assert result.text == "Done via Claude."
    assert len(result.tool_events) == 1


# --------------------------------------------------------------------------
# build_client factory
# --------------------------------------------------------------------------


def test_build_client_openai_compatible() -> None:
    client = build_client(
        kind=ProviderKind.OPENAI_COMPATIBLE, base_url="http://x/v1", api_key=None, model="m", timeout=5
    )
    assert isinstance(client, OpenAICompatibleClient)


def test_build_client_anthropic() -> None:
    client = build_client(
        kind=ProviderKind.ANTHROPIC, base_url="https://api.anthropic.com", api_key=None, model="m", timeout=5
    )
    assert isinstance(client, AnthropicClient)
