"""Tests for app.core.fs_handler: root-scoped directory browsing and the
path-traversal safety guarantees."""
from __future__ import annotations

from pathlib import Path

import pytest

from app.core import fs_handler
from app.core.fs_handler import PathSecurityError, Root


def _root(path: Path) -> Root:
    return Root(id="r1", label="Test Root", path=str(path))


def test_resolve_within_root_allows_nested_paths(models_dir: Path) -> None:
    root = _root(models_dir)
    resolved = fs_handler.resolve_within_root(root, "nested/other.gguf")
    assert resolved == (models_dir / "nested" / "other.gguf").resolve()


@pytest.mark.parametrize("escape_path", ["../", "../../etc/passwd", "nested/../../"])
def test_resolve_within_root_rejects_traversal(models_dir: Path, escape_path: str) -> None:
    root = _root(models_dir)
    with pytest.raises(PathSecurityError):
        fs_handler.resolve_within_root(root, escape_path)


def test_relative_to_root_is_inverse_of_resolve(models_dir: Path) -> None:
    root = _root(models_dir)
    resolved = fs_handler.resolve_within_root(root, "nested/other.gguf")
    assert fs_handler.relative_to_root(resolved, root) == "nested/other.gguf"


def test_list_directory_sorts_dirs_first_then_alphabetical(models_dir: Path) -> None:
    root = _root(models_dir)
    entries = fs_handler.list_directory(root)

    names = [e["name"] for e in entries]
    dirs = [e["is_dir"] for e in entries]

    assert dirs == sorted(dirs, reverse=True)  # True (dir) entries first
    assert "nested" in names
    assert "sample.gguf" in names
    assert "notes.txt" in names


def test_list_directory_flags_gguf_files(models_dir: Path) -> None:
    root = _root(models_dir)
    entries = {e["name"]: e for e in fs_handler.list_directory(root)}

    assert entries["sample.gguf"]["is_gguf"] is True
    assert entries["notes.txt"]["is_gguf"] is False
    assert entries["nested"]["is_gguf"] is False


def test_list_directory_missing_path_raises(models_dir: Path) -> None:
    root = _root(models_dir)
    with pytest.raises(FileNotFoundError):
        fs_handler.list_directory(root, "does-not-exist")


def test_list_directory_on_file_raises_not_a_directory(models_dir: Path) -> None:
    root = _root(models_dir)
    with pytest.raises(NotADirectoryError):
        fs_handler.list_directory(root, "sample.gguf")


def test_search_gguf_files_recursive_and_filtered(models_dir: Path) -> None:
    root = _root(models_dir)
    results = fs_handler.search_gguf_files(root, "")
    names = {r["name"] for r in results}
    assert names == {"sample.gguf", "other.gguf"}


def test_search_gguf_files_query_filters_by_name(models_dir: Path) -> None:
    root = _root(models_dir)
    results = fs_handler.search_gguf_files(root, "other")
    assert [r["name"] for r in results] == ["other.gguf"]


def test_search_gguf_files_respects_limit(models_dir: Path) -> None:
    root = _root(models_dir)
    results = fs_handler.search_gguf_files(root, "", limit=1)
    assert len(results) == 1


def test_is_gguf_file(models_dir: Path) -> None:
    assert fs_handler.is_gguf_file(models_dir / "sample.gguf") is True
    assert fs_handler.is_gguf_file(models_dir / "notes.txt") is False
