"""Application configuration.

Settings are loaded from environment variables (or a `.env` file) so the
backend can be configured without touching code, e.g. when running inside
Docker. All paths default to a local ``data`` directory so the app works
out of the box for local, single-user usage.
"""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GGUF_EDITOR_", env_file=".env", extra="ignore")

    # Directory used for the SQLite database, encryption secret, and backups.
    data_dir: str = str(Path(__file__).resolve().parent.parent / "data")

    # Comma separated list of "label:path" or plain "path" entries used to
    # seed the model root list on first launch (handy for Docker volumes).
    default_roots: str = ""

    # CORS origins allowed to call the API (the Next.js dev server by default).
    cors_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # Maximum number of array items returned inline for large metadata arrays
    # (token lists, merges, ...). Larger arrays are truncated with a preview.
    max_inline_array_items: int = 32

    # Network timeout (seconds) used when talking to LLM provider endpoints.
    llm_request_timeout: float = 120.0

    @property
    def data_path(self) -> Path:
        path = Path(self.data_dir)
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def db_path(self) -> Path:
        return self.data_path / "gguf_editor.db"

    @property
    def secret_key_path(self) -> Path:
        return self.data_path / "secret.key"

    @property
    def backups_path(self) -> Path:
        path = self.data_path / "backups"
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def default_root_list(self) -> list[tuple[str, str]]:
        """Parse ``default_roots`` into a list of ``(label, path)`` tuples."""
        entries: list[tuple[str, str]] = []
        for raw in self.default_roots.split(os.pathsep if os.pathsep in self.default_roots else ","):
            raw = raw.strip()
            if not raw:
                continue
            if ":" in raw and not raw[1:2] == ":\\":  # avoid breaking Windows drive letters
                label, _, path = raw.partition(":")
            else:
                label, path = Path(raw).name or raw, raw
            entries.append((label, path))
        return entries


@lru_cache
def get_settings() -> Settings:
    return Settings()
