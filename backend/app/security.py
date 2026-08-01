"""Local encryption helpers for API keys and other secrets.

API keys (BYOK / global provider credentials) are never returned to the
frontend once stored, and are encrypted at rest using a locally generated
Fernet key. This keeps secrets out of the SQLite database in plaintext,
matching the "keys never leak" requirement from the product brief.
"""
from __future__ import annotations

import stat
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.config import get_settings


def _load_or_create_key(path: Path) -> bytes:
    if path.exists():
        return path.read_bytes()

    key = Fernet.generate_key()
    path.write_bytes(key)
    try:
        path.chmod(stat.S_IRUSR | stat.S_IWUSR)  # 0600, owner read/write only
    except OSError:
        # Best effort on platforms that don't support POSIX permissions.
        pass
    return key


@lru_cache
def _fernet() -> Fernet:
    settings = get_settings()
    key = _load_or_create_key(settings.secret_key_path)
    return Fernet(key)


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a plaintext secret, returning a URL-safe token string."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("utf-8")


def decrypt_secret(token: str) -> str:
    """Decrypt a token previously produced by :func:`encrypt_secret`."""
    try:
        return _fernet().decrypt(token.encode("utf-8")).decode("utf-8")
    except InvalidToken as exc:  # pragma: no cover - defensive
        raise ValueError("Unable to decrypt stored secret; the secret key may have changed.") from exc
