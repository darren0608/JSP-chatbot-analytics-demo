"""Chat service: guardrails, token-budgeted prompt assembly, streaming RAG
answer, session persistence (brief §6)."""
import time
from typing import Iterator

from sqlalchemy.orm import Session

from ..config import settings
from ..models import Conversation, Message
from ..providers import get_llm_provider
from ..providers.local import content_words
from .prompts import ASSISTANT_SYSTEM_PROMPT
from .retrieval import retrieve

# Cheap in-domain check used as a guardrail before retrieval. Anything that
# shares no vocabulary with the domain AND retrieves below the minimum score is
# treated as out-of-scope and answered with a polite redirect, never a guess.
_DOMAIN_WORDS = frozenset(
    "job jobs role roles career careers skill skills training course courses learn learning "
    "work employment salary pay industry sector hire hiring resume interview switch pathway "
    "upskill reskill certification qualification analyst developer engineer designer manager "
    "data software cyber cybersecurity marketing nurse teacher technician profession occupation".split()
)

OUT_OF_SCOPE_REPLY = (
    "I'm focused on jobs, skills, careers, and training, so I can't help with "
    "that. I can help you explore the skills needed for a role, compare "
    "roles, plan a career switch, or find out about training areas — happy to "
    "dig into any of those."
)

MAX_HISTORY_TURNS = 8  # token budget: recent turns only; older context summarised
_TITLE_MAX = 72


def is_in_domain(query: str) -> bool:
    return bool(set(content_words(query)) & _DOMAIN_WORDS)


def make_title(first_message: str) -> str:
    words = first_message.strip().split()
    title = " ".join(words[:12]).rstrip("?.!,")
    return (title[:_TITLE_MAX] + "…") if len(title) > _TITLE_MAX else (title or "New conversation")


def _history_for_prompt(conversation: Conversation) -> list[dict]:
    msgs = [m for m in conversation.messages]
    recent = msgs[-(MAX_HISTORY_TURNS * 2):]
    history = [{"role": m.role, "content": m.content} for m in recent]
    # Running summary seam: if the session is long, prepend a compact summary
    # of the dropped turns instead of sending them all.
    dropped = msgs[: len(msgs) - len(recent)]
    if dropped:
        topics = ", ".join({make_title(m.content) for m in dropped if m.role == "user"})
        history.insert(0, {
            "role": "user",
            "content": f"(Summary of earlier conversation topics: {topics})",
        })
    return history


def stream_chat(db: Session, conversation: Conversation, user_text: str) -> Iterator[dict]:
    """Yields event dicts: {type: 'sources'|'token'|'done', ...}.
    Persists the user message and the assistant reply."""
    started = time.monotonic()

    user_msg = Message(
        conversation_id=conversation.id, role="user", content=user_text,
        tokens=len(user_text.split()),
    )
    db.add(user_msg)
    if len(conversation.messages) == 0:
        conversation.title = make_title(user_text)
    db.flush()

    chunks = retrieve(db, user_text)
    top_score = max((c.score for c in chunks), default=0.0)
    grounded = [c for c in chunks if c.score >= settings.retrieval_min_score]
    user_msg.retrieval_score = top_score

    out_of_scope = not is_in_domain(user_text) and not grounded

    sources = [
        {"title": c.title, "source_url": c.source_url, "score": c.score}
        for c in grounded
    ]
    yield {"type": "sources", "sources": [] if out_of_scope else sources}

    parts: list[str] = []
    if out_of_scope:
        parts.append(OUT_OF_SCOPE_REPLY)
        yield {"type": "token", "text": OUT_OF_SCOPE_REPLY}
        used_chunk_ids: list[str] = []
    else:
        llm = get_llm_provider()
        history = _history_for_prompt(conversation)
        # exclude the just-added user message from history (it's passed as `question`)
        if history and history[-1]["content"] == user_text:
            history = history[:-1]
        for token in llm.stream_answer(
            ASSISTANT_SYSTEM_PROMPT, history, user_text,
            [c.as_passage() for c in grounded],
        ):
            parts.append(token)
            yield {"type": "token", "text": token}
        used_chunk_ids = [c.chunk_id for c in grounded]

    answer = "".join(parts)
    latency_ms = int((time.monotonic() - started) * 1000)
    assistant_msg = Message(
        conversation_id=conversation.id, role="assistant", content=answer,
        tokens=len(answer.split()), latency_ms=latency_ms,
        retrieved_chunk_ids=used_chunk_ids, retrieval_score=top_score,
    )
    db.add(assistant_msg)
    db.commit()

    yield {
        "type": "done",
        "message_id": assistant_msg.id,
        "conversation_id": conversation.id,
        "title": conversation.title,
        "latency_ms": latency_ms,
    }
