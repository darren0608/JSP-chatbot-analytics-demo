"""ORM models — schema per brief §8, plus `intent_taxonomy` (taxonomy admin)
and retrieval-quality fields used by the Content Gaps view."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, JSON, String, Text,
)
from sqlalchemy.orm import relationship

from .config import settings
from .db import Base, IS_POSTGRES

if IS_POSTGRES:
    from pgvector.sqlalchemy import Vector

    EmbeddingType = Vector(settings.embedding_dim)
else:
    EmbeddingType = JSON


def _uuid() -> str:
    return str(uuid.uuid4())


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    id = Column(String(36), primary_key=True, default=_uuid)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    role = Column(String(16), nullable=False, default="user")  # user | admin
    consent_analytics = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    conversations = relationship("Conversation", back_populates="user", cascade="all, delete-orphan")


class Conversation(Base):
    __tablename__ = "conversations"
    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False, default="New conversation")
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user = relationship("User", back_populates="conversations")
    messages = relationship(
        "Message", back_populates="conversation",
        cascade="all, delete-orphan", order_by="Message.created_at",
    )


class Message(Base):
    __tablename__ = "messages"
    id = Column(String(36), primary_key=True, default=_uuid)
    conversation_id = Column(String(36), ForeignKey("conversations.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(16), nullable=False)  # user | assistant
    content = Column(Text, nullable=False)
    tokens = Column(Integer, default=0)
    latency_ms = Column(Integer, default=0)
    retrieved_chunk_ids = Column(JSON, default=list)
    retrieval_score = Column(Float, nullable=True)  # max hybrid score for this turn
    created_at = Column(DateTime(timezone=True), default=utcnow, index=True)

    conversation = relationship("Conversation", back_populates="messages")


class Document(Base):
    __tablename__ = "documents"
    id = Column(String(36), primary_key=True, default=_uuid)
    source_url = Column(String(1024), nullable=False, unique=True, index=True)
    content_type = Column(String(32), nullable=False, index=True)
    title = Column(String(512), nullable=False)
    raw_text = Column(Text, nullable=False)
    content_hash = Column(String(64), nullable=False)
    fetched_at = Column(DateTime(timezone=True), default=utcnow)

    chunks = relationship("Chunk", back_populates="document", cascade="all, delete-orphan")


class Chunk(Base):
    __tablename__ = "chunks"
    id = Column(String(36), primary_key=True, default=_uuid)
    document_id = Column(String(36), ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    text = Column(Text, nullable=False)
    embedding = Column(EmbeddingType, nullable=True)
    meta = Column("metadata", JSON, default=dict)  # source_url, content_type, title, fetched_at

    document = relationship("Document", back_populates="chunks")


class QueryAnalysis(Base):
    __tablename__ = "query_analysis"
    id = Column(String(36), primary_key=True, default=_uuid)
    message_id = Column(String(36), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    intent_label = Column(String(64), nullable=False, index=True)
    intent_confidence = Column(Float, nullable=False, default=0.0)
    embedding = Column(EmbeddingType, nullable=True)
    retrieval_score = Column(Float, nullable=True)
    redacted_text = Column(Text, nullable=False, default="")
    processed_at = Column(DateTime(timezone=True), default=utcnow)


class Entity(Base):
    __tablename__ = "entities"
    id = Column(String(36), primary_key=True, default=_uuid)
    message_id = Column(String(36), ForeignKey("messages.id", ondelete="CASCADE"), nullable=False, index=True)
    entity_type = Column(String(16), nullable=False, index=True)  # job_role|skill|sector|course
    value_raw = Column(String(255), nullable=False)
    value_normalized = Column(String(255), nullable=False, index=True)
    canonical_id = Column(String(64), nullable=True)  # link to official taxonomy when supplied


class Cluster(Base):
    __tablename__ = "clusters"
    id = Column(String(36), primary_key=True, default=_uuid)
    label = Column(String(255), nullable=False)
    summary = Column(Text, default="")
    size = Column(Integer, default=0)
    centroid = Column(EmbeddingType, nullable=True)
    run_id = Column(String(36), nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)


class MessageCluster(Base):
    __tablename__ = "message_cluster"
    message_id = Column(String(36), ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True)
    cluster_id = Column(String(36), ForeignKey("clusters.id", ondelete="CASCADE"), primary_key=True)
    distance = Column(Float, default=0.0)


class IntentTaxonomy(Base):
    """Seed intent taxonomy, editable in JSP Insights. Emergent clusters can be
    promoted into rows here (origin='promoted')."""
    __tablename__ = "intent_taxonomy"
    id = Column(String(36), primary_key=True, default=_uuid)
    label = Column(String(64), unique=True, nullable=False)
    description = Column(Text, default="")
    keywords = Column(JSON, default=list)  # phrases used by the seed classifier
    origin = Column(String(16), default="seed")  # seed | promoted
    active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)
