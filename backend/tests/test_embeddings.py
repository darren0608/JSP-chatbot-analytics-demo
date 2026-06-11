"""Embedding-provider tests. The sentence-transformers tests inject a fake
module so they run without torch or a model download — the real model is
exercised on first ingest in the deployed stack."""
import sys
import types

import pytest

from app.config import settings
from app.providers import get_embedding_provider


class _FakeVector(list):
    def tolist(self):
        return list(self)


class _FakeSentenceTransformer:
    DIM = 4

    def __init__(self, model_name):
        self.model_name = model_name

    def get_sentence_embedding_dimension(self):
        return self.DIM

    def encode(self, texts, normalize_embeddings=False):
        return [_FakeVector([1.0, 0.0, 0.0, 0.0]) for _ in texts]


@pytest.fixture()
def fake_st(monkeypatch):
    mod = types.ModuleType("sentence_transformers")
    mod.SentenceTransformer = _FakeSentenceTransformer
    monkeypatch.setitem(sys.modules, "sentence_transformers", mod)
    yield mod


def test_st_provider_dim_mismatch_raises(fake_st, monkeypatch):
    from app.providers.st_embeddings import SentenceTransformerEmbeddingProvider
    monkeypatch.setattr(settings, "embedding_dim", 256)  # model dim is 4
    with pytest.raises(RuntimeError, match="JSP_EMBEDDING_DIM"):
        SentenceTransformerEmbeddingProvider()


def test_st_provider_embeds(fake_st, monkeypatch):
    from app.providers.st_embeddings import SentenceTransformerEmbeddingProvider
    monkeypatch.setattr(settings, "embedding_dim", _FakeSentenceTransformer.DIM)
    provider = SentenceTransformerEmbeddingProvider()
    out = provider.embed(["hello", "world"])
    assert out == [[1.0, 0.0, 0.0, 0.0], [1.0, 0.0, 0.0, 0.0]]
    assert provider.embed([]) == []


def test_factory_registers_sentence_transformers(fake_st, monkeypatch):
    monkeypatch.setattr(settings, "embedding_provider", "sentence_transformers")
    monkeypatch.setattr(settings, "embedding_dim", _FakeSentenceTransformer.DIM)
    get_embedding_provider.cache_clear()
    try:
        provider = get_embedding_provider()
        assert provider.dim == _FakeSentenceTransformer.DIM
    finally:
        get_embedding_provider.cache_clear()


def test_factory_unknown_provider_message(monkeypatch):
    monkeypatch.setattr(settings, "embedding_provider", "nope")
    get_embedding_provider.cache_clear()
    try:
        with pytest.raises(ValueError, match="Unknown embedding provider"):
            get_embedding_provider()
    finally:
        get_embedding_provider.cache_clear()


def test_ingest_force_reembeds_unchanged_docs(client):
    """Switching embedders requires re-embedding content whose hash is
    unchanged — `ingest --reembed` (force=True) must do that."""
    from app.db import SessionLocal
    from app.ingestion.pipeline import ingest

    db = SessionLocal()
    try:
        first = ingest(db)
        assert first["chunks_upserted"] > 0
        plain_rerun = ingest(db)
        assert plain_rerun["chunks_upserted"] == 0  # delta-only baseline
        forced = ingest(db, force=True)
        assert forced["chunks_upserted"] == first["chunks_upserted"]
        assert forced["unchanged"] == 0
    finally:
        db.close()
