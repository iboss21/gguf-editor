"""Persistence for LLM provider configurations (Local / Global / BYOK).

API keys are encrypted at rest (see :mod:`app.security`) and are only ever
decrypted server-side to make an outbound request to the provider; the
public API representation (:class:`ProviderPublic`) never includes them.
"""
from __future__ import annotations

from dataclasses import dataclass

from app.db import get_conn, new_id, now_iso
from app.models.schemas import ProviderCreate, ProviderKind, ProviderPublic, ProviderScope, ProviderUpdate
from app.security import decrypt_secret, encrypt_secret


class ProviderNotFoundError(Exception):
    pass


@dataclass
class ProviderRecord:
    """Internal, full representation of a provider - may include a decrypted API key."""

    id: str
    name: str
    kind: ProviderKind
    scope: ProviderScope
    base_url: str
    model: str | None
    api_key: str | None
    created_at: str
    updated_at: str

    def to_public(self) -> ProviderPublic:
        return ProviderPublic(
            id=self.id,
            name=self.name,
            kind=self.kind,
            scope=self.scope,
            base_url=self.base_url,
            model=self.model,
            has_api_key=bool(self.api_key),
            created_at=self.created_at,
            updated_at=self.updated_at,
        )


def _row_to_record(row) -> ProviderRecord:
    encrypted = row["api_key_encrypted"]
    api_key = decrypt_secret(encrypted) if encrypted else None
    return ProviderRecord(
        id=row["id"],
        name=row["name"],
        kind=ProviderKind(row["kind"]),
        scope=ProviderScope(row["scope"]),
        base_url=row["base_url"],
        model=row["model"],
        api_key=api_key,
        created_at=row["created_at"],
        updated_at=row["updated_at"],
    )


def list_providers() -> list[ProviderRecord]:
    with get_conn() as conn:
        rows = conn.execute("SELECT * FROM providers ORDER BY created_at ASC").fetchall()
    return [_row_to_record(r) for r in rows]


def get_provider(provider_id: str) -> ProviderRecord:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM providers WHERE id = ?", (provider_id,)).fetchone()
    if row is None:
        raise ProviderNotFoundError(provider_id)
    return _row_to_record(row)


def create_provider(payload: ProviderCreate) -> ProviderRecord:
    provider_id = new_id()
    created_at = now_iso()
    encrypted_key = encrypt_secret(payload.api_key) if payload.api_key else None

    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO providers (id, name, kind, scope, base_url, model, api_key_encrypted, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                provider_id,
                payload.name,
                payload.kind.value,
                payload.scope.value,
                payload.base_url.rstrip("/"),
                payload.model,
                encrypted_key,
                created_at,
                created_at,
            ),
        )

    return get_provider(provider_id)


def update_provider(provider_id: str, payload: ProviderUpdate) -> ProviderRecord:
    current = get_provider(provider_id)

    name = payload.name if payload.name is not None else current.name
    base_url = payload.base_url.rstrip("/") if payload.base_url is not None else current.base_url
    model = payload.model if payload.model is not None else current.model

    if payload.clear_api_key:
        encrypted_key: str | None = None
    elif payload.api_key:
        encrypted_key = encrypt_secret(payload.api_key)
    else:
        encrypted_key = encrypt_secret(current.api_key) if current.api_key else None

    updated_at = now_iso()

    with get_conn() as conn:
        cur = conn.execute(
            """
            UPDATE providers
            SET name = ?, base_url = ?, model = ?, api_key_encrypted = ?, updated_at = ?
            WHERE id = ?
            """,
            (name, base_url, model, encrypted_key, updated_at, provider_id),
        )
        if cur.rowcount == 0:
            raise ProviderNotFoundError(provider_id)

    return get_provider(provider_id)


def delete_provider(provider_id: str) -> None:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM providers WHERE id = ?", (provider_id,))
        if cur.rowcount == 0:
            raise ProviderNotFoundError(provider_id)
