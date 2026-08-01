"""Local file browser endpoints.

Browsing is always scoped to a registered "root" directory (see
``routes_explorer.py``'s ``roots`` endpoints) so the backend never exposes
arbitrary filesystem access - only the folders the user explicitly points
the app at (e.g. an Ollama/LM Studio models directory).
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import get_root_or_404
from app.core import fs_handler, roots_repo
from app.models.schemas import DirectoryListing, EntryInfo, RootCreate, RootInfo, SearchResult

router = APIRouter()


@router.get("/roots", response_model=list[RootInfo])
def list_roots() -> list[RootInfo]:
    return roots_repo.list_roots()


@router.post("/roots", response_model=RootInfo, status_code=201)
def create_root(payload: RootCreate) -> RootInfo:
    try:
        return roots_repo.add_root(payload.path, payload.label)
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except roots_repo.DuplicateRootError as exc:
        raise HTTPException(status_code=409, detail=f"Root already registered: {exc}") from exc


@router.delete("/roots/{root_id}", status_code=204)
def delete_root(root_id: str) -> None:
    try:
        roots_repo.delete_root(root_id)
    except roots_repo.RootNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown root_id '{root_id}'") from exc


@router.get("/browse", response_model=DirectoryListing)
def browse(root_id: str, path: str = Query("", alias="path")) -> DirectoryListing:
    root = get_root_or_404(root_id)
    try:
        entries = fs_handler.list_directory(root, path)
    except fs_handler.PathSecurityError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (FileNotFoundError, NotADirectoryError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    parent = None
    if path:
        parent = "/".join(path.rstrip("/").split("/")[:-1])

    return DirectoryListing(
        root_id=root_id,
        rel_path=path,
        parent_rel_path=parent,
        entries=[EntryInfo(**e) for e in entries],
    )


@router.get("/search", response_model=SearchResult)
def search(root_id: str, query: str = "", limit: int = 200) -> SearchResult:
    root = get_root_or_404(root_id)
    results = fs_handler.search_gguf_files(root, query, limit=limit)
    return SearchResult(root_id=root_id, query=query, results=[EntryInfo(**e) for e in results])
