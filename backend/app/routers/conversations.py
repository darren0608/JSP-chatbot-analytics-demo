from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import get_current_user
from ..models import Conversation, User

router = APIRouter(prefix="/api/conversations", tags=["conversations"])


class ConversationOut(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str


class MessageOut(BaseModel):
    id: str
    role: str
    content: str
    retrieved_chunk_ids: list | None = None
    created_at: str


def _own_conversation(conversation_id: str, user: User, db: Session) -> Conversation:
    conv = db.get(Conversation, conversation_id)
    if not conv or conv.user_id != user.id:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conv


@router.get("", response_model=list[ConversationOut])
def list_conversations(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    convs = (db.query(Conversation).filter(Conversation.user_id == user.id)
             .order_by(Conversation.updated_at.desc()).all())
    return [ConversationOut(id=c.id, title=c.title,
                            created_at=c.created_at.isoformat(),
                            updated_at=c.updated_at.isoformat()) for c in convs]


@router.post("", response_model=ConversationOut)
def create_conversation(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    conv = Conversation(user_id=user.id)
    db.add(conv)
    db.commit()
    return ConversationOut(id=conv.id, title=conv.title,
                           created_at=conv.created_at.isoformat(),
                           updated_at=conv.updated_at.isoformat())


@router.get("/{conversation_id}/messages", response_model=list[MessageOut])
def get_messages(conversation_id: str, user: User = Depends(get_current_user),
                 db: Session = Depends(get_db)):
    conv = _own_conversation(conversation_id, user, db)
    return [MessageOut(id=m.id, role=m.role, content=m.content,
                       retrieved_chunk_ids=m.retrieved_chunk_ids,
                       created_at=m.created_at.isoformat()) for m in conv.messages]


@router.delete("/{conversation_id}")
def delete_conversation(conversation_id: str, user: User = Depends(get_current_user),
                        db: Session = Depends(get_db)):
    conv = _own_conversation(conversation_id, user, db)
    db.delete(conv)
    db.commit()
    return {"ok": True}
