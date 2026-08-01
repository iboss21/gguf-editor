"""HTTP-level tests for the GGUF inspect/edit/rebrand/download routes."""
from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient


def _create_root(app_client: TestClient, path: Path) -> str:
    resp = app_client.post("/api/explorer/roots", json={"path": str(path), "label": "Models"})
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_inspect_returns_metadata_and_tensors(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp = app_client.post("/api/gguf/inspect", json={"root_id": root_id, "rel_path": "sample.gguf"})
    assert resp.status_code == 200, resp.text

    body = resp.json()
    assert body["architecture"] == "qwen2"
    assert body["tensor_count"] == 1
    by_key = {m["key"]: m for m in body["metadata"]}
    assert by_key["general.name"]["value"] == "Qwen2-Test-7B"


def test_inspect_missing_file_404(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp = app_client.post("/api/gguf/inspect", json={"root_id": root_id, "rel_path": "does-not-exist.gguf"})
    assert resp.status_code == 404


def test_inspect_non_gguf_file_400(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp = app_client.post("/api/gguf/inspect", json={"root_id": root_id, "rel_path": "notes.txt"})
    assert resp.status_code == 400


def test_apply_metadata_edits_overwrite_with_backup(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp = app_client.post(
        "/api/gguf/metadata",
        json={
            "root_id": root_id,
            "rel_path": "sample.gguf",
            "edits": [
                {"op": "set", "key": "general.license", "value": "mit", "value_type": "STRING"},
                {"op": "delete", "key": "test.tags"},
            ],
            "output": {"mode": "overwrite", "backup": True},
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["success"] is True
    assert body["output_rel_path"] == "sample.gguf"
    assert body["backup_rel_path"] is not None
    assert Path(body["backup_rel_path"]).exists()

    by_key = {m["key"]: m for m in body["file"]["metadata"]}
    assert by_key["general.license"]["value"] == "mit"
    assert "test.tags" not in by_key


def test_apply_metadata_edits_no_edits_400(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp = app_client.post(
        "/api/gguf/metadata", json={"root_id": root_id, "rel_path": "sample.gguf", "edits": []}
    )
    assert resp.status_code == 400


def test_rebrand_preview_excludes_architecture(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp = app_client.post(
        "/api/gguf/rebrand/preview",
        json={"root_id": root_id, "rel_path": "sample.gguf", "find": "Qwen", "replace": "Reges"},
    )
    assert resp.status_code == 200
    edits = resp.json()["edits"]
    keys = {e["key"] for e in edits}
    assert "general.architecture" not in keys
    assert "general.name" in keys


def test_rebrand_apply_creates_new_file_by_default(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp = app_client.post(
        "/api/gguf/rebrand",
        json={"root_id": root_id, "rel_path": "sample.gguf", "find": "Qwen", "replace": "Reges"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["output_rel_path"] != "sample.gguf"
    assert body["file"]["architecture"] == "qwen2"

    by_key = {m["key"]: m for m in body["file"]["metadata"]}
    assert "Reges" in by_key["general.name"]["value"]

    # Original file must be untouched (new_name mode is the default).
    original_resp = app_client.post("/api/gguf/inspect", json={"root_id": root_id, "rel_path": "sample.gguf"})
    original_name = next(m for m in original_resp.json()["metadata"] if m["key"] == "general.name")
    assert original_name["value"] == "Qwen2-Test-7B"


def test_rebrand_apply_does_not_collide_with_source_filename(app_client: TestClient, models_dir: Path) -> None:
    """Regression test: when the search term isn't literally in the filename,
    the suggested output name must never collapse onto the source file's name
    (which would silently overwrite it despite the default NEW_NAME mode)."""
    root_id = _create_root(app_client, models_dir)
    resp = app_client.post(
        "/api/gguf/rebrand",
        json={"root_id": root_id, "rel_path": "sample.gguf", "find": "Qwen", "replace": "Reges"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["output_rel_path"] == "sample-edited.gguf"


def test_rebrand_apply_renames_file_when_term_matches_filename(app_client: TestClient, tmp_path: Path) -> None:
    """When the rebrand term does appear in the filename, the output file
    should be renamed accordingly."""
    from tests.conftest import make_sample_gguf

    models = tmp_path / "models2"
    models.mkdir()
    make_sample_gguf(models / "Qwen-Model.gguf")

    root_id = _create_root(app_client, models)
    resp = app_client.post(
        "/api/gguf/rebrand",
        json={"root_id": root_id, "rel_path": "Qwen-Model.gguf", "find": "Qwen", "replace": "Reges"},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["output_rel_path"] == "Reges-Model.gguf"


def test_rebrand_no_matches_returns_422(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp = app_client.post(
        "/api/gguf/rebrand",
        json={"root_id": root_id, "rel_path": "sample.gguf", "find": "NoSuchTerm", "replace": "X"},
    )
    assert resp.status_code == 422


def test_download_returns_file_bytes(app_client: TestClient, models_dir: Path) -> None:
    root_id = _create_root(app_client, models_dir)
    resp = app_client.get("/api/gguf/download", params={"root_id": root_id, "rel_path": "sample.gguf"})
    assert resp.status_code == 200
    assert resp.content == (models_dir / "sample.gguf").read_bytes()
