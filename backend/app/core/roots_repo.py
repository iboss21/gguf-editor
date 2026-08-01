"""Persistence + validation for registered model root directories."""
from __future__ import annotations

from app.core.fs_handler import Root, normalize_root_path
from app.db import get_conn, new_id, now_iso
from app.models.schemas import RootInfo


class RootNotFoundError(Exception):
    pass


class DuplicateRootError(Exception):
    pass


def _row_to_info(row) -> RootInfo:
    exists = normalize_root_path(row["path"]).is_dir()
    return RootInfo(id=row["id"], label=row["label"], path=row["path"], exists=exists, created_at=row["created_at"])


def list_roots() -> list[RootInfo]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM roots ORDER BY created_at ASC").fetchall()
    return [_row_to_info(r) for r in rows]


def get_root(root_id: str) -> Root:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM roots WHERE id = ?", (root_id,)).fetchone()
    if row is None:
        raise RootNotFoundError(root_id)
    return Root(id=row["id"], label=row["label"], path=row["path"])


def add_root(raw_path: str, label: str | None) -> RootInfo:
    resolved = normalize_root_path(raw_path)
    if not resolved.exists():
        raise FileNotFoundError(f"Directory does not exist: {raw_path}")
    if not resolved.is_dir():
        raise NotADirectoryError(f"Not a directory: {raw_path}")

    resolved_str = str(resolved)
    root_id = new_id()
    created_at = now_iso()
    display_label = label.strip() if label and label.strip() else resolved.name or resolved_str

    with get_conn() as conn:
        existing = conn.execute("SELECT id FROM roots WHERE path = ?", (resolved_str,)).fetchone()
        if existing is not None:
            raise DuplicateRootError(resolved_str)
        conn.execute(
            "INSERT INTO roots (id, label, path, created_at) VALUES (?, ?, ?, ?)",
            (root_id, display_label, resolved_str, created_at),
        )

    return RootInfo(id=root_id, label=display_label, path=resolved_str, exists=True, created_at=created_at)


def delete_root(root_id: str) -> None:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM roots WHERE id = ?", (root_id,))
        if cur.rowcount == 0:
            raise RootNotFoundError(root_id)
