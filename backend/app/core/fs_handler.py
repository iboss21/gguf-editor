"""Local filesystem access for the model explorer.

All browsing is restricted to a set of registered "roots" (directories the
user explicitly points the app at, e.g. an Ollama/LM Studio models folder).
Every path is resolved and validated to stay inside its root, which
prevents path-traversal outside of directories the user has approved.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

GGUF_SUFFIX = ".gguf"


class PathSecurityError(ValueError):
    """Raised when a requested path would escape its registered root."""


@dataclass
class Root:
    id: str
    label: str
    path: str


def normalize_root_path(raw_path: str) -> Path:
    """Expand ``~`` and environment variables, then resolve to an absolute path."""
    expanded = os.path.expandvars(os.path.expanduser(raw_path))
    return Path(expanded).resolve()


def resolve_within_root(root: Root, rel_path: str = "") -> Path:
    """Resolve ``rel_path`` relative to ``root`` and guarantee it stays inside it.

    Raises :class:`PathSecurityError` if the resolved path would escape the
    root directory (e.g. via ``..`` segments or an absolute path override).
    """
    root_path = normalize_root_path(root.path)
    candidate = (root_path / rel_path).resolve() if rel_path else root_path

    try:
        candidate.relative_to(root_path)
    except ValueError as exc:
        raise PathSecurityError(f"Path '{rel_path}' escapes root '{root.label}'") from exc

    return candidate


def relative_to_root(path: Path, root: Root) -> str:
    """Inverse of :func:`resolve_within_root`: express an absolute path as a
    root-relative, forward-slashed string."""
    root_path = normalize_root_path(root.path)
    return str(Path(path).resolve().relative_to(root_path)).replace(os.sep, "/")


def is_gguf_file(path: Path) -> bool:
    return path.is_file() and path.suffix.lower() == GGUF_SUFFIX


def _entry_info(path: Path, root_path: Path) -> dict:
    try:
        stat = path.stat()
        size = stat.st_size if path.is_file() else None
        modified = datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat()
    except OSError:
        size, modified = None, None

    return {
        "name": path.name,
        "rel_path": str(path.relative_to(root_path)).replace(os.sep, "/"),
        "is_dir": path.is_dir(),
        "is_gguf": is_gguf_file(path),
        "size_bytes": size,
        "modified_at": modified,
    }


def list_directory(root: Root, rel_path: str = "", show_hidden: bool = False) -> list[dict]:
    """List the immediate children of ``rel_path`` inside ``root``.

    Directories are returned before files, both sorted alphabetically
    (case-insensitive). Hidden (dot-prefixed) entries are skipped unless
    ``show_hidden`` is set.
    """
    root_path = normalize_root_path(root.path)
    target = resolve_within_root(root, rel_path)

    if not target.exists():
        raise FileNotFoundError(f"Path does not exist: {rel_path or '.'}")
    if not target.is_dir():
        raise NotADirectoryError(f"Not a directory: {rel_path or '.'}")

    entries: list[dict] = []
    with os.scandir(target) as it:
        for entry in it:
            if not show_hidden and entry.name.startswith("."):
                continue
            try:
                entries.append(_entry_info(Path(entry.path), root_path))
            except OSError:
                continue

    entries.sort(key=lambda e: (not e["is_dir"], e["name"].lower()))
    return entries


def search_gguf_files(root: Root, query: str, limit: int = 200) -> list[dict]:
    """Recursively search ``root`` for ``.gguf`` files whose name matches ``query``."""
    root_path = normalize_root_path(root.path)
    query_lower = query.lower().strip()
    results: list[dict] = []

    for dirpath, dirnames, filenames in os.walk(root_path):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for filename in filenames:
            if not filename.lower().endswith(GGUF_SUFFIX):
                continue
            if query_lower and query_lower not in filename.lower():
                continue
            full_path = Path(dirpath) / filename
            try:
                results.append(_entry_info(full_path, root_path))
            except OSError:
                continue
            if len(results) >= limit:
                return results

    return results

