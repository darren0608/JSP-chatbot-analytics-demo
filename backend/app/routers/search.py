"""Direct retrieval endpoint (P1 deliverable; also useful for debugging RAG)."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import User
from ..rag.retrieval import retrieve

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("")
def search(q: str = Query(..., min_length=1), top_k: int = Query(6, le=20),
           content_type: str | None = None,
           _: User = Depends(get_current_user), db: Session = Depends(get_db)):
    results = retrieve(db, q, top_k=top_k, content_type=content_type or "auto")
    return [
        {"chunk_id": r.chunk_id, "score": r.score, "title": r.title,
         "source_url": r.source_url, "content_type": r.content_type,
         "text": r.text[:500]}
        for r in results
    ]
