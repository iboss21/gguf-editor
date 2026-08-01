"""Tests for app.security: API key encryption at rest."""
from __future__ import annotations

import stat
from pathlib import Path

import pytest

from app import security
from app.config import get_settings


def test_encrypt_decrypt_round_trip() -> None:
    token = security.encrypt_secret("sk-super-secret-value")
    assert token != "sk-super-secret-value"
    assert security.decrypt_secret(token) == "sk-super-secret-value"


def test_encrypted_token_is_not_plaintext_substring() -> None:
    secret = "sk-abcdefgh12345"
    token = security.encrypt_secret(secret)
    assert secret not in token


def test_decrypt_garbage_token_raises_value_error() -> None:
    with pytest.raises(ValueError):
        security.decrypt_secret("not-a-valid-fernet-token")


def test_secret_key_file_created_with_owner_only_permissions() -> None:
    settings = get_settings()
    # Trigger key creation.
    security.encrypt_secret("trigger-key-creation")

    key_path: Path = settings.secret_key_path
    assert key_path.exists()

    mode = stat.S_IMODE(key_path.stat().st_mode)
    assert mode == stat.S_IRUSR | stat.S_IWUSR


def test_secret_key_is_reused_across_calls() -> None:
    security.encrypt_secret("first")
    settings = get_settings()
    key_bytes_first = settings.secret_key_path.read_bytes()

    security.encrypt_secret("second")
    key_bytes_second = settings.secret_key_path.read_bytes()

    assert key_bytes_first == key_bytes_second
