"""HTTP-level tests for the provider (Local/Global/BYOK) CRUD + test-connection routes."""
from __future__ import annotations

import httpx
import pytest
from fastapi.testclient import TestClient


def test_create_provider_without_api_key(app_client: TestClient) -> None:
    resp = app_client.post(
        "/api/providers",
        json={
            "name": "Ollama (local)", "kind": "openai_compatible", "scope": "local",
            "base_url": "http://localhost:11434/v1", "model": "qwen2.5",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["has_api_key"] is False
    assert "api_key" not in body


def test_create_provider_with_api_key_never_returns_raw_key(app_client: TestClient) -> None:
    resp = app_client.post(
        "/api/providers",
        json={
            "name": "OpenAI", "kind": "openai_compatible", "scope": "global",
            "base_url": "https://api.openai.com/v1", "api_key": "sk-super-secret", "model": "gpt-4o-mini",
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["has_api_key"] is True
    assert "sk-super-secret" not in resp.text


def test_list_providers(app_client: TestClient) -> None:
    app_client.post(
        "/api/providers",
        json={"name": "A", "kind": "openai_compatible", "scope": "local", "base_url": "http://localhost:1/v1"},
    )
    listed = app_client.get("/api/providers").json()
    assert len(listed) == 1
    assert listed[0]["name"] == "A"


def test_update_provider(app_client: TestClient) -> None:
    created = app_client.post(
        "/api/providers",
        json={"name": "A", "kind": "openai_compatible", "scope": "local", "base_url": "http://localhost:1/v1"},
    ).json()

    resp = app_client.put(f"/api/providers/{created['id']}", json={"name": "Renamed"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Renamed"


def test_update_unknown_provider_404(app_client: TestClient) -> None:
    resp = app_client.put("/api/providers/does-not-exist", json={"name": "X"})
    assert resp.status_code == 404


def test_delete_provider(app_client: TestClient) -> None:
    created = app_client.post(
        "/api/providers",
        json={"name": "A", "kind": "openai_compatible", "scope": "local", "base_url": "http://localhost:1/v1"},
    ).json()

    resp = app_client.delete(f"/api/providers/{created['id']}")
    assert resp.status_code == 204
    assert app_client.get("/api/providers").json() == []


def test_delete_unknown_provider_404(app_client: TestClient) -> None:
    resp = app_client.delete("/api/providers/does-not-exist")
    assert resp.status_code == 404


def test_test_provider_unknown_404(app_client: TestClient) -> None:
    resp = app_client.post("/api/providers/does-not-exist/test")
    assert resp.status_code == 404


def test_test_provider_success(app_client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    created = app_client.post(
        "/api/providers",
        json={"name": "Mock", "kind": "openai_compatible", "scope": "local", "base_url": "http://mock/v1"},
    ).json()

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"data": [{"id": "mock-model"}]})

    transport = httpx.MockTransport(handler)
    original_init = httpx.AsyncClient.__init__

    def patched_init(self, *args, **kwargs):
        kwargs["transport"] = transport
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "__init__", patched_init)

    resp = app_client.post(f"/api/providers/{created['id']}/test")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["models"] == ["mock-model"]


def test_test_provider_connection_failure(app_client: TestClient) -> None:
    created = app_client.post(
        "/api/providers",
        json={
            "name": "Unreachable", "kind": "openai_compatible", "scope": "local",
            "base_url": "http://127.0.0.1:1/v1",
        },
    ).json()

    resp = app_client.post(f"/api/providers/{created['id']}/test")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is False
    assert body["models"] == []
