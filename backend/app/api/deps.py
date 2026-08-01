"""Shared FastAPI dependency helpers for the API routes."""
from __future__ import annotations

from pathlib import Path

from fastapi import HTTPException

from app.core import fs_handler, roots_repo
from app.core.fs_handler import Root


def get_root_or_404(root_id: str) -> Root:
    try:
        return roots_repo.get_root(root_id)
    except roots_repo.RootNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown root_id '{root_id}'") from exc


def resolve_gguf_path(root_id: str, rel_path: str) -> tuple[Root, Path]:
    root = get_root_or_404(root_id)
    try:
        path = fs_handler.resolve_within_root(root, rel_path)
    except fs_handler.PathSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {rel_path}")
    if path.suffix.lower() != fs_handler.GGUF_SUFFIX:
        raise HTTPException(status_code=400, detail="Only .gguf files are supported")

    return root, path
