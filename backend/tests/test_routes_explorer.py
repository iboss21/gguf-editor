"""HTTP-level tests for the explorer routes (roots CRUD, browse, search)."""
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _create_root(app_client: TestClient, path: Path, label: str = "Test Models") -> dict:
    resp = app_client.post("/api/explorer/roots", json={"path": str(path), "label": label})
    assert resp.status_code == 201, resp.text
    return resp.json()


def test_create_list_and_delete_root(app_client: TestClient, models_dir: Path) -> None:
    created = _create_root(app_client, models_dir)
    assert created["label"] == "Test Models"
    assert created["exists"] is True

    listed = app_client.get("/api/explorer/roots").json()
    assert [r["id"] for r in listed] == [created["id"]]

    resp = app_client.delete(f"/api/explorer/roots/{created['id']}")
    assert resp.status_code == 204
    assert app_client.get("/api/explorer/roots").json() == []


def test_create_root_nonexistent_directory_400(app_client: TestClient, tmp_path: Path) -> None:
    resp = app_client.post("/api/explorer/roots", json={"path": str(tmp_path / "nope"), "label": "X"})
    assert resp.status_code == 400


def test_create_root_duplicate_path_409(app_client: TestClient, models_dir: Path) -> None:
    _create_root(app_client, models_dir)
    resp = app_client.post("/api/explorer/roots", json={"path": str(models_dir), "label": "Again"})
    assert resp.status_code == 409


def test_delete_unknown_root_404(app_client: TestClient) -> None:
    resp = app_client.delete("/api/explorer/roots/does-not-exist")
    assert resp.status_code == 404


def test_browse_root_lists_entries(app_client: TestClient, models_dir: Path) -> None:
    created = _create_root(app_client, models_dir)
    resp = app_client.get("/api/explorer/browse", params={"root_id": created["id"], "path": ""})
    assert resp.status_code == 200
    body = resp.json()
    names = {e["name"] for e in body["entries"]}
    assert names == {"sample.gguf", "nested", "notes.txt"}


def test_browse_nested_directory(app_client: TestClient, models_dir: Path) -> None:
    created = _create_root(app_client, models_dir)
    resp = app_client.get("/api/explorer/browse", params={"root_id": created["id"], "path": "nested"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["parent_rel_path"] == ""
    assert [e["name"] for e in body["entries"]] == ["other.gguf"]


def test_browse_path_traversal_rejected(app_client: TestClient, models_dir: Path) -> None:
    created = _create_root(app_client, models_dir)
    resp = app_client.get("/api/explorer/browse", params={"root_id": created["id"], "path": "../../etc"})
    assert resp.status_code == 400


def test_browse_unknown_root_404(app_client: TestClient) -> None:
    resp = app_client.get("/api/explorer/browse", params={"root_id": "nope", "path": ""})
    assert resp.status_code == 404


def test_search_finds_gguf_files_by_name(app_client: TestClient, models_dir: Path) -> None:
    created = _create_root(app_client, models_dir)
    resp = app_client.get("/api/explorer/search", params={"root_id": created["id"], "query": "other"})
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert [r["name"] for r in results] == ["other.gguf"]
