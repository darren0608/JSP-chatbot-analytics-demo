import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import settings
from .db import init_db
from .routers import admin, auth, chat, conversations, search

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    if settings.seed_on_start:
        from .cli import seed
        seed()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

# Frontend dev server origins; in docker compose the web app proxies /api so
# CORS is mostly a dev convenience.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(conversations.router)
app.include_router(chat.router)
app.include_router(search.router)
app.include_router(admin.router)


@app.get("/api/health")
def health():
    return {"status": "ok", "llm_provider": settings.llm_provider,
            "embedding_provider": settings.embedding_provider}
