"""Database engine/session. Postgres+pgvector in production (docker compose),
SQLite fallback for local development and tests.

Embeddings: on Postgres the `chunks.embedding` / `query_analysis.embedding` /
`clusters.centroid` columns are real pgvector `vector(N)` columns; on SQLite
they are JSON lists and similarity is computed in NumPy. Both paths store and
return plain Python lists at the model boundary.
"""
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base

from .config import settings

IS_POSTGRES = settings.database_url.startswith("postgres")

connect_args = {} if IS_POSTGRES else {"check_same_thread": False}
engine = create_engine(settings.database_url, connect_args=connect_args, pool_pre_ping=True)

if not IS_POSTGRES:
    @event.listens_for(engine, "connect")
    def _sqlite_fk(dbapi_conn, _):
        dbapi_conn.execute("PRAGMA foreign_keys=ON")

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
Base = declarative_base()


def init_db() -> None:
    if IS_POSTGRES:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
    # Prototype-scale migrations: create_all is idempotent. Seam: replace with
    # Alembic before production.
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
