"""HTTP-level tests for the agentic /api/chat endpoint: the tool-calling loop,
pending-edit staging, and auto-apply-to-disk behavior."""
from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def mock_rebrand_llm(monkeypatch: pytest.MonkeyPatch):
    """Simulate an OpenAI-compatible model that calls bulk_rebrand once, then
    finishes with a plain text summary."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        if body["messages"][-1].get("role") == "tool":
            return httpx.Response(
                200,
                json={"choices": [{"message": {"role": "assistant", "content": "Rebranded successfully."}}]},
            )
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
                                        "arguments": json.dumps({"find": "Qwen", "replace": "Reges"}),
                                    },
                                }
                            ],
                        }
                    }
                ]
            },
        )

    transport = httpx.MockTransport(handler)
    original_init = httpx.AsyncClient.__init__

    def patched_init(self, *args, **kwargs):
        kwargs["transport"] = transport
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)


def _create_root(app_client: TestClient, path: Path) -> str:
    resp = app_client.post("/api/explorer/roots", json={"path": str(path), "label": "Models"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def _create_provider(app_client: TestClient) -> str:
    resp = app_client.post(
        "/api/providers",
        json={
            "name": "Mock", "kind": "openai_compatible", "scope": "local",
            "base_url": "http://mock/v1", "model": "mock",
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_chat_without_target_file_has_no_tools(app_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        assert "tools" not in body
        return httpx.Response(200, json={"choices": [{"message": {"role": "assistant", "content": "Hi there!"}}]})

    transport = httpx.MockTransport(handler)
    original_init = httpx.AsyncClient.__init__

    def patched_init(self, *args, **kwargs):
        kwargs["transport"] = transport
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)

    provider_id = _create_provider(app_client)
    resp = app_client.post(
        "/api/chat", json={"provider_id": provider_id, "messages": [{"role": "user", "content": "hello"}]}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["message"]["content"] == "Hi there!"
    assert body["pending_edits"] == []
    assert body["applied"] is False


def test_chat_unknown_provider_404(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp = app_client.post(
        "/api/chat",
        json={
            "provider_id": "does-not-exist",
            "messages": [{"role": "user", "content": "hi"}],
            "target": {"root_id": root_id, "rel_path": "sample.gguf"},
        },
    )
    assert resp.status_code == 404


def test_chat_empty_messages_400(app_client: TestClient) -> None:
    provider_id = _create_provider(app_client)
    resp = app_client.post("/api/chat", json={"provider_id": provider_id, "messages": []})
    assert resp.status_code == 400


def test_chat_rebrand_stages_edits_without_auto_apply(
    app_client: TestClient, models_dir: Path, mock_rebrand_llm
) -> None:
    root_id = _create_root(app_client, models_dir)
    provider_id = _create_provider(app_client)

    resp = app_client.post(
        "/api/chat",
        json={
            "provider_id": provider_id,
            "messages": [{"role": "user", "content": "Please rebrand this model from Qwen to Reges"}],
            "target": {"root_id": root_id, "rel_path": "sample.gguf"},
            "auto_apply": False,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["applied"] is False
    assert body["output_rel_path"] is None
    assert len(body["tool_events"]) == 1
    assert body["tool_events"][0]["tool"] == "bulk_rebrand"

    pending_keys = {e["key"] for e in body["pending_edits"]}
    assert "general.name" in pending_keys

    preview = {m["key"]: m for m in body["metadata_preview"]}
    assert "Reges" in preview["general.name"]["value"]
    assert preview["general.architecture"]["value"] == "qwen2"  # never rebranded

    # Nothing written to disk yet.
    original = app_client.post("/api/gguf/inspect", json={"root_id": root_id, "rel_path": "sample.gguf"}).json()
    original_name = next(m for m in original["metadata"] if m["key"] == "general.name")
    assert original_name["value"] == "Qwen2-Test-7B"


def test_chat_rebrand_with_auto_apply_writes_file(
    app_client: TestClient, models_dir: Path, mock_rebrand_llm
) -> None:
    root_id = _create_root(app_client, models_dir)
    provider_id = _create_provider(app_client)

    resp = app_client.post(
        "/api/chat",
        json={
            "provider_id": provider_id,
            "messages": [{"role": "user", "content": "Please rebrand this model from Qwen to Reges and save it"}],
            "target": {"root_id": root_id, "rel_path": "sample.gguf"},
            "auto_apply": True,
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    assert body["applied"] is True
    assert body["pending_edits"] == []
    assert body["output_rel_path"] is not None

    saved = app_client.post(
        "/api/gguf/inspect", json={"root_id": root_id, "rel_path": body["output_rel_path"]}
    ).json()
    saved_name = next(m for m in saved["metadata"] if m["key"] == "general.name")
    assert "Reges" in saved_name["value"]
    assert saved["architecture"] == "qwen2"

    # Original untouched (default NEW_NAME output mode).
    original = app_client.post("/api/gguf/inspect", json={"root_id": root_id, "rel_path": "sample.gguf"}).json()
    original_name = next(m for m in original["metadata"] if m["key"] == "general.name")
    assert original_name["value"] == "Qwen2-Test-7B"


def test_chat_provider_connection_error_returns_502(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp_provider = app_client.post(
        "/api/providers",
        json={
            "name": "Unreachable", "kind": "openai_compatible", "scope": "local",
            "base_url": "http://127.0.0.1:1/v1",
        },
    )
    provider_id = resp_provider.json()["id"]

    resp = app_client.post(
        "/api/chat",
        json={
            "provider_id": provider_id,
            "messages": [{"role": "user", "content": "hi"}],
            "target": {"root_id": root_id, "rel_path": "sample.gguf"},
        },
    )
    assert resp.status_code == 502
