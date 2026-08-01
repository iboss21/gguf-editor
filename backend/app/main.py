"""FastAPI application entrypoint for the GGUF Editor backend."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import routes_chat, routes_explorer, routes_gguf, routes_health, routes_providers
from app.config import get_settings
from app.db import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="GGUF Editor API",
        description="Local-first backend for browsing, inspecting, and AI-assisted editing of GGUF model files.",
        version="0.1.0",
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(routes_health.router, prefix="/api", tags=["health"])
    app.include_router(routes_explorer.router, prefix="/api/explorer", tags=["explorer"])
    app.include_router(routes_gguf.router, prefix="/api/gguf", tags=["gguf"])
    app.include_router(routes_providers.router, prefix="/api/providers", tags=["providers"])
    app.include_router(routes_chat.router, prefix="/api/chat", tags=["chat"])

    return app


app = create_app()
