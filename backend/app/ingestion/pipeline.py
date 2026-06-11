"""Ingestion pipeline: fetch → parse → normalise → chunk → embed → upsert.

Delta-only: documents carry a content_hash; unchanged documents are skipped,
changed documents have their chunks re-embedded, new documents are inserted.
Idempotent and safe to re-run on a schedule (brief §5).
"""
import hashlib
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Chunk, Document
from ..providers import get_embedding_provider
from .adapters import SourceAdapter, get_adapter
from .chunking import chunk_text

log = logging.getLogger(__name__)


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def ingest(db: Session, adapter: SourceAdapter | None = None) -> dict:
    adapter = adapter or get_adapter()
    embedder = get_embedding_provider()
    stats = {"new": 0, "updated": 0, "unchanged": 0, "chunks_upserted": 0}

    for rec in adapter.fetch():
        content_hash = _hash(rec["text"])
        doc = db.query(Document).filter(Document.source_url == rec["source_url"]).first()

        if doc and doc.content_hash == content_hash:
            stats["unchanged"] += 1
            continue

        if doc:
            db.query(Chunk).filter(Chunk.document_id == doc.id).delete()
            stats["updated"] += 1
        else:
            doc = Document(source_url=rec["source_url"])
            db.add(doc)
            stats["new"] += 1

        doc.content_type = rec["content_type"]
        doc.title = rec["title"]
        doc.raw_text = rec["text"]
        doc.content_hash = content_hash
        doc.fetched_at = datetime.now(timezone.utc)
        db.flush()

        pieces = chunk_text(rec["text"], settings.chunk_target_tokens)
        embeddings = embedder.embed(pieces)
        for text, emb in zip(pieces, embeddings):
            db.add(Chunk(
                document_id=doc.id,
                text=text,
                embedding=emb,
                meta={
                    "source_url": doc.source_url,
                    "content_type": doc.content_type,
                    "title": doc.title,
                    "fetched_at": doc.fetched_at.isoformat(),
                },
            ))
            stats["chunks_upserted"] += 1

    db.commit()
    log.info("ingest complete: %s", stats)
    return stats
