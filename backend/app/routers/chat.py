"""Chat endpoint: SSE streaming, per-user rate limiting (brief §11)."""
import json
import time
from collections import defaultdict, deque

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from ..config import settings
from ..db import get_db
from ..deps import get_current_user
from ..models import Conversation, User
from ..rag.chat import stream_chat

router = APIRouter(prefix="/api/chat", tags=["chat"])

# In-memory sliding-window rate limiter. Seam: move to Redis for multi-replica.
_request_log: dict[str, deque] = defaultdict(deque)


def _check_rate_limit(user_id: str) -> None:
    now = time.monotonic()
    window = _request_log[user_id]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= settings.chat_rate_limit_per_minute:
        raise HTTPException(status_code=429, detail="Rate limit exceeded; try again shortly")
    window.append(now)


class ChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str

    @field_validator("message")
    @classmethod
    def _msg(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("message must not be empty")
        if len(v) > 4000:
            raise ValueError("message too long (max 4000 chars)")
        return v


@router.post("")
def chat(body: ChatRequest, user: User = Depends(get_current_user),
         db: Session = Depends(get_db)):
    _check_rate_limit(user.id)

    if body.conversation_id:
        conv = db.get(Conversation, body.conversation_id)
        if not conv or conv.user_id != user.id:
            raise HTTPException(status_code=404, detail="Conversation not found")
    else:
        conv = Conversation(user_id=user.id)
        db.add(conv)
        db.flush()

    def event_stream():
        for event in stream_chat(db, conv, body.message):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
