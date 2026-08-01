"""Shared pytest fixtures for the GGUF Editor backend test suite.

Each test gets a fully isolated data directory (fresh SQLite DB + encryption
key) via the ``GGUF_EDITOR_DATA_DIR`` environment variable, so tests never
share state or touch the real ``backend/data`` directory.
"""
from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import numpy as np
import pytest
from fastapi.testclient import TestClient
from gguf import GGUFWriter

from app import security
from app.config import get_settings
from app.db import init_db


@pytest.fixture(autouse=True)
def _isolated_settings(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Point every test at its own throwaway data directory."""
    data_dir = tmp_path / "app-data"
    monkeypatch.setenv("GGUF_EDITOR_DATA_DIR", str(data_dir))
    monkeypatch.setenv("GGUF_EDITOR_DEFAULT_ROOTS", "")
    get_settings.cache_clear()
    security._fernet.cache_clear()  # noqa: SLF001 - reset the cached Fernet key per test
    init_db()
    yield
    get_settings.cache_clear()
    security._fernet.cache_clear()  # noqa: SLF001


@pytest.fixture
def app_client() -> Iterator[TestClient]:
    """A FastAPI TestClient built fresh (after settings are already isolated)."""
    from app.main import create_app

    with TestClient(create_app()) as client:
        yield client


def make_sample_gguf(path: Path, *, name: str = "Qwen2-Test-7B") -> Path:
    """Write a small, realistic synthetic GGUF file for tests to operate on."""
    writer = GGUFWriter(str(path), arch="qwen2")
    writer.add_name(name)
    writer.add_description(f"A tiny test model for {name.split('-')[0]}")
    writer.add_context_length(4096)
    writer.add_embedding_length(64)
    writer.add_block_count(2)
    writer.add_head_count(4)
    writer.add_file_type(0)
    writer.add_string("general.license", "apache-2.0")
    writer.add_array("test.tags", ["qwen", "chat", "test"])

    tensor_data = np.arange(32 * 64, dtype=np.float32).reshape(32, 64)
    writer.add_tensor("token_embd.weight", tensor_data)

    writer.write_header_to_file()
    writer.write_kv_data_to_file()
    writer.write_tensors_to_file()
    writer.close()
    return path


@pytest.fixture
def sample_gguf(tmp_path: Path) -> Path:
    """A standalone sample GGUF file not inside any registered root."""
    return make_sample_gguf(tmp_path / "sample.gguf")


@pytest.fixture
def models_dir(tmp_path: Path) -> Path:
    """A directory (with a nested subfolder) containing sample GGUF files, for
    use as an explorer "root"."""
    root = tmp_path / "models"
    root.mkdir()
    make_sample_gguf(root / "sample.gguf")
    nested = root / "nested"
    nested.mkdir()
    make_sample_gguf(nested / "other.gguf", name="Llama-Test-8B")
    (root / "notes.txt").write_text("not a gguf file")
    return root
