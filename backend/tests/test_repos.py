"""Tests for the DB-backed repositories: roots_repo and providers_repo."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.core import providers_repo, roots_repo
from app.models.schemas import ProviderCreate, ProviderKind, ProviderScope, ProviderUpdate

# --------------------------------------------------------------------------
# roots_repo
# --------------------------------------------------------------------------


def test_add_root_and_get_root(models_dir: Path) -> None:
    info = roots_repo.add_root(str(models_dir), "My Models")

    assert info.label == "My Models"
    assert info.exists is True

    root = roots_repo.get_root(info.id)
    assert root.path == str(models_dir)


def test_add_root_defaults_label_to_dirname(models_dir: Path) -> None:
    info = roots_repo.add_root(str(models_dir), None)
    assert info.label == models_dir.name


def test_add_root_missing_directory_raises(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError):
        roots_repo.add_root(str(tmp_path / "nope"), None)


def test_add_root_on_file_raises_not_a_directory(models_dir: Path) -> None:
    with pytest.raises(NotADirectoryError):
        roots_repo.add_root(str(models_dir / "sample.gguf"), None)


def test_add_root_duplicate_path_raises(models_dir: Path) -> None:
    roots_repo.add_root(str(models_dir), "First")
    with pytest.raises(roots_repo.DuplicateRootError):
        roots_repo.add_root(str(models_dir), "Second")


def test_list_roots_ordered_by_creation(tmp_path: Path) -> None:
    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    dir_a.mkdir()
    dir_b.mkdir()

    roots_repo.add_root(str(dir_a), "A")
    roots_repo.add_root(str(dir_b), "B")

    labels = [r.label for r in roots_repo.list_roots()]
    assert labels == ["A", "B"]


def test_get_root_unknown_raises() -> None:
    with pytest.raises(roots_repo.RootNotFoundError):
        roots_repo.get_root("does-not-exist")


def test_delete_root(models_dir: Path) -> None:
    info = roots_repo.add_root(str(models_dir), "Temp")
    roots_repo.delete_root(info.id)

    with pytest.raises(roots_repo.RootNotFoundError):
        roots_repo.get_root(info.id)


def test_delete_root_unknown_raises() -> None:
    with pytest.raises(roots_repo.RootNotFoundError):
        roots_repo.delete_root("does-not-exist")


# --------------------------------------------------------------------------
# providers_repo
# --------------------------------------------------------------------------


def test_create_provider_without_api_key() -> None:
    record = providers_repo.create_provider(
        ProviderCreate(
            name="Ollama", kind=ProviderKind.OPENAI_COMPATIBLE, scope=ProviderScope.LOCAL,
            base_url="http://localhost:11434/v1", model="qwen2.5",
        )
    )

    assert record.api_key is None
    assert record.to_public().has_api_key is False


def test_create_provider_with_api_key_is_encrypted_at_rest() -> None:
    record = providers_repo.create_provider(
        ProviderCreate(
            name="OpenAI", kind=ProviderKind.OPENAI_COMPATIBLE, scope=ProviderScope.GLOBAL,
            base_url="https://api.openai.com/v1", api_key="sk-test-123", model="gpt-4o-mini",
        )
    )

    assert record.api_key == "sk-test-123"  # decrypted for internal use
    assert record.to_public().has_api_key is True

    from app.db import get_conn

    with get_conn() as conn:
        row = conn.execute("SELECT api_key_encrypted FROM providers WHERE id = ?", (record.id,)).fetchone()
    assert row["api_key_encrypted"] != "sk-test-123"


def test_update_provider_can_change_fields_and_clear_key() -> None:
    record = providers_repo.create_provider(
        ProviderCreate(
            name="BYOK", kind=ProviderKind.ANTHROPIC, scope=ProviderScope.BYOK,
            base_url="https://api.anthropic.com", api_key="sk-ant-123", model="claude-3-5-sonnet-latest",
        )
    )

    updated = providers_repo.update_provider(record.id, ProviderUpdate(name="Renamed"))
    assert updated.name == "Renamed"
    assert updated.api_key == "sk-ant-123"  # preserved when not explicitly changed

    cleared = providers_repo.update_provider(record.id, ProviderUpdate(clear_api_key=True))
    assert cleared.api_key is None
    assert cleared.to_public().has_api_key is False


def test_update_provider_unknown_raises() -> None:
    with pytest.raises(providers_repo.ProviderNotFoundError):
        providers_repo.update_provider("does-not-exist", ProviderUpdate(name="X"))


def test_delete_provider() -> None:
    record = providers_repo.create_provider(
        ProviderCreate(
            name="Temp", kind=ProviderKind.OPENAI_COMPATIBLE, scope=ProviderScope.LOCAL,
            base_url="http://localhost:1234/v1",
        )
    )
    providers_repo.delete_provider(record.id)

    with pytest.raises(providers_repo.ProviderNotFoundError):
        providers_repo.get_provider(record.id)


def test_delete_provider_unknown_raises() -> None:
    with pytest.raises(providers_repo.ProviderNotFoundError):
        providers_repo.delete_provider("does-not-exist")
