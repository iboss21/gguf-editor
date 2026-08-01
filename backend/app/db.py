"""Tiny SQLite persistence layer.

The app is designed for local, single-user usage so a lightweight hand
rolled data-access layer (instead of a full ORM) keeps the dependency
footprint small while remaining easy to reason about and test.
"""
from __future__ import annotations

import sqlite3
import uuid
from collections.abc import Iterator
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path

from app.config import get_settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS roots (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    scope TEXT NOT NULL,
    base_url TEXT NOT NULL,
    model TEXT,
    api_key_encrypted TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);
"""


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _db_path() -> Path:
    return get_settings().db_path


@contextmanager
def get_conn() -> Iterator[sqlite3.Connection]:
    conn = sqlite3.connect(_db_path())
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    finally:
        conn.close()


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript(SCHEMA)
        _seed_default_roots(conn)


def _seed_default_roots(conn: sqlite3.Connection) -> None:
    settings = get_settings()
    existing = conn.execute("SELECT COUNT(*) AS c FROM roots").fetchone()["c"]
    if existing or not settings.default_root_list:
        return
    for label, path in settings.default_root_list:
        resolved = str(Path(path).expanduser())
        conn.execute(
            "INSERT OR IGNORE INTO roots (id, label, path, created_at) VALUES (?, ?, ?, ?)",
            (new_id(), label, resolved, now_iso()),
        )
