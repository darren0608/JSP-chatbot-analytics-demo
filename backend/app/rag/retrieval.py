"""Hybrid retrieval: vector similarity + keyword overlap, with optional
content_type metadata filter (brief §6).

On Postgres, the vector leg uses pgvector's cosine operator (`<=>`) so the
database does the heavy lifting; on SQLite (dev/tests) embeddings are JSON and
similarity is computed in NumPy. The keyword leg is a lightweight normalised
term-overlap score (BM25 seam: swap in Postgres FTS `ts_rank` here when corpus
size warrants it). Final score = 0.65 * vector + 0.35 * keyword.
"""
from dataclasses import dataclass

import numpy as np
from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from ..config import settings
from ..db import IS_POSTGRES
from ..models import Chunk
from ..providers import get_embedding_provider
from ..providers.local import content_words

# Hint words that map a query onto a content_type filter (§6: "restrict to
# course when the user asks about training").
_TYPE_HINTS = {
    "course": ["course", "courses", "training", "class", "classes", "certification", "certificate", "learn"],
    "career_pathway": ["pathway", "switch", "transition", "career change", "move into"],
}


def infer_content_type_filter(query: str) -> str | None:
    q = query.lower()
    for ctype, hints in _TYPE_HINTS.items():
        if any(h in q for h in hints):
            return ctype
    return None


@dataclass
class RetrievedChunk:
    chunk_id: str
    text: str
    source_url: str
    title: str
    content_type: str
    score: float

    def as_passage(self) -> dict:
        return {
            "text": self.text, "source_url": self.source_url,
            "title": self.title, "score": self.score,
        }


def _keyword_score(query_words: set[str], chunk_text: str) -> float:
    if not query_words:
        return 0.0
    cwords = set(content_words(chunk_text))
    return len(query_words & cwords) / len(query_words)


def _vector_candidates(db: Session, query_emb: list[float], limit: int) -> list[tuple[Chunk, float]]:
    if IS_POSTGRES:
        emb_literal = "[" + ",".join(f"{v:.6f}" for v in query_emb) + "]"
        rows = db.execute(
            sql_text(
                "SELECT id, 1 - (embedding <=> :q) AS sim FROM chunks "
                "ORDER BY embedding <=> :q LIMIT :lim"
            ),
            {"q": emb_literal, "lim": limit},
        ).fetchall()
        sims = {r[0]: float(r[1]) for r in rows}
        chunks = db.query(Chunk).filter(Chunk.id.in_(list(sims))).all()
        return [(c, sims[c.id]) for c in chunks]
    # SQLite/dev: brute-force cosine in NumPy (fine at prototype scale).
    chunks = db.query(Chunk).all()
    if not chunks:
        return []
    q = np.array(query_emb)
    qn = np.linalg.norm(q) or 1.0
    scored = []
    for c in chunks:
        if not c.embedding:
            continue
        v = np.array(c.embedding)
        sim = float(np.dot(q, v) / (qn * (np.linalg.norm(v) or 1.0)))
        scored.append((c, sim))
    scored.sort(key=lambda t: -t[1])
    return scored[:limit]


def retrieve(db: Session, query: str, top_k: int | None = None,
             content_type: str | None = "auto") -> list[RetrievedChunk]:
    top_k = top_k or settings.retrieval_top_k
    if content_type == "auto":
        content_type = infer_content_type_filter(query)

    embedder = get_embedding_provider()
    query_emb = embedder.embed_one(query)
    qwords = set(content_words(query))

    candidates = _vector_candidates(db, query_emb, limit=top_k * 6)
    results = []
    for chunk, vec_sim in candidates:
        meta = chunk.meta or {}
        kw = _keyword_score(qwords, chunk.text)
        score = 0.65 * max(vec_sim, 0.0) + 0.35 * kw
        results.append(RetrievedChunk(
            chunk_id=chunk.id,
            text=chunk.text,
            source_url=meta.get("source_url", ""),
            title=meta.get("title", ""),
            content_type=meta.get("content_type", ""),
            score=round(score, 4),
        ))

    # Soft metadata filter: prefer the hinted type but fall back to the full
    # pool so a course-phrased question still gets role/skill context.
    if content_type:
        preferred = [r for r in results if r.content_type == content_type]
        others = [r for r in results if r.content_type != content_type]
        results = preferred + others

    results.sort(key=lambda r: -r.score)
    if content_type:
        preferred = [r for r in results if r.content_type == content_type][: max(2, top_k // 2)]
        rest = [r for r in results if r not in preferred]
        results = preferred + rest

    return results[:top_k]
