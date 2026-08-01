"""LLM provider configuration endpoints (Local / Global / BYOK)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.config import get_settings
from app.core import providers_repo
from app.core.llm_providers import build_client
from app.models.schemas import ProviderCreate, ProviderPublic, ProviderTestResult, ProviderUpdate

router = APIRouter()


@router.get("", response_model=list[ProviderPublic])
def list_providers() -> list[ProviderPublic]:
    return [p.to_public() for p in providers_repo.list_providers()]


@router.post("", response_model=ProviderPublic, status_code=201)
def create_provider(payload: ProviderCreate) -> ProviderPublic:
    record = providers_repo.create_provider(payload)
    return record.to_public()


@router.put("/{provider_id}", response_model=ProviderPublic)
def update_provider(provider_id: str, payload: ProviderUpdate) -> ProviderPublic:
    try:
        record = providers_repo.update_provider(provider_id, payload)
    except providers_repo.ProviderNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown provider_id '{provider_id}'") from exc
    return record.to_public()


@router.delete("/{provider_id}", status_code=204)
def delete_provider(provider_id: str) -> None:
    try:
        providers_repo.delete_provider(provider_id)
    except providers_repo.ProviderNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown provider_id '{provider_id}'") from exc


@router.post("/{provider_id}/test", response_model=ProviderTestResult)
async def test_provider(provider_id: str) -> ProviderTestResult:
    try:
        record = providers_repo.get_provider(provider_id)
    except providers_repo.ProviderNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown provider_id '{provider_id}'") from exc

    settings = get_settings()
    client = build_client(
        kind=record.kind,
        base_url=record.base_url,
        api_key=record.api_key,
        model=record.model,
        timeout=settings.llm_request_timeout,
    )
    ok, detail, models = await client.test_connection()
    return ProviderTestResult(ok=ok, detail=detail, models=models)
