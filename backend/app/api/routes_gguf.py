"""GGUF inspection and editing endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.api.deps import resolve_gguf_path
from app.core import fs_handler, gguf_handler
from app.models.schemas import (
    ApplyEditsRequest,
    ApplyEditsResponse,
    GGUFFileInfo,
    InspectRequest,
    OutputMode,
    RebrandRequest,
)

router = APIRouter()


@router.post("/inspect", response_model=GGUFFileInfo)
def inspect(payload: InspectRequest) -> GGUFFileInfo:
    _root, path = resolve_gguf_path(payload.root_id, payload.rel_path)
    try:
        return gguf_handler.inspect_file(path, payload.root_id, payload.rel_path)
    except gguf_handler.GGUFHandlerError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/metadata", response_model=ApplyEditsResponse)
def apply_metadata_edits(payload: ApplyEditsRequest) -> ApplyEditsResponse:
    root, path = resolve_gguf_path(payload.root_id, payload.rel_path)

    if not payload.edits:
        raise HTTPException(status_code=400, detail="No edits provided")

    try:
        final_path, backup_path = gguf_handler.perform_edit(
            path,
            root_id=payload.root_id,
            rel_path=payload.rel_path,
            edits=payload.edits,
            output=payload.output,
        )
    except gguf_handler.GGUFHandlerError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    output_rel_path = fs_handler.relative_to_root(final_path, root)
    backup_rel_path = str(backup_path) if backup_path else None

    info = gguf_handler.inspect_file(final_path, payload.root_id, output_rel_path)
    return ApplyEditsResponse(
        success=True,
        output_rel_path=output_rel_path,
        backup_rel_path=backup_rel_path,
        file=info,
    )


@router.post("/rebrand/preview")
def preview_rebrand(payload: RebrandRequest) -> dict:
    _root, path = resolve_gguf_path(payload.root_id, payload.rel_path)
    try:
        info = gguf_handler.inspect_file(path, payload.root_id, payload.rel_path)
        edits = gguf_handler.build_rebrand_edits(
            info, payload.find, payload.replace, case_sensitive=payload.case_sensitive, keys=payload.keys
        )
    except gguf_handler.GGUFHandlerError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"edits": edits}


@router.post("/rebrand", response_model=ApplyEditsResponse)
def rebrand(payload: RebrandRequest) -> ApplyEditsResponse:
    root, path = resolve_gguf_path(payload.root_id, payload.rel_path)

    try:
        info = gguf_handler.inspect_file(path, payload.root_id, payload.rel_path)
        edits = gguf_handler.build_rebrand_edits(
            info, payload.find, payload.replace, case_sensitive=payload.case_sensitive, keys=payload.keys
        )
        if not edits:
            raise HTTPException(status_code=422, detail=f"No brand-safe metadata fields contained '{payload.find}'")

        output = payload.output
        if output.filename is None and payload.include_filename:
            candidate_stem = gguf_handler.replace_preserving_case(
                path.stem, payload.find, payload.replace, payload.case_sensitive
            )
            # Only rename the file itself if the rebrand term actually appears in
            # the filename; otherwise keep the auto-generated "-edited" suffix so
            # NEW_NAME mode never silently collapses onto the source file's name.
            if candidate_stem != path.stem and output.mode != OutputMode.OVERWRITE:
                output = output.model_copy(update={"filename": candidate_stem + ".gguf"})

        final_path, backup_path = gguf_handler.perform_edit(
            path,
            root_id=payload.root_id,
            rel_path=payload.rel_path,
            edits=edits,
            output=output,
        )
    except gguf_handler.GGUFHandlerError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    output_rel_path = fs_handler.relative_to_root(final_path, root)
    backup_rel_path = str(backup_path) if backup_path else None
    info = gguf_handler.inspect_file(final_path, payload.root_id, output_rel_path)

    return ApplyEditsResponse(
        success=True,
        output_rel_path=output_rel_path,
        backup_rel_path=backup_rel_path,
        file=info,
    )


@router.get("/download")
def download(root_id: str, rel_path: str) -> FileResponse:
    _root, path = resolve_gguf_path(root_id, rel_path)
    return FileResponse(path, filename=path.name, media_type="application/octet-stream")
