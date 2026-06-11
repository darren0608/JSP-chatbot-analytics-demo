"""Sentence-transformers embedding provider — real semantic embeddings that
run on-box (nothing leaves the deployment; no embeddings API involved).

Select with JSP_EMBEDDING_PROVIDER=sentence_transformers. The model is set by
JSP_EMBEDDING_MODEL and JSP_EMBEDDING_DIM must match its output dimension
(the pgvector column dimension is created from JSP_EMBEDDING_DIM). Switching
embedders requires a full re-embed: `python -m app.cli ingest --reembed`.
"""
from ..config import settings
from .base import EmbeddingProvider


class SentenceTransformerEmbeddingProvider(EmbeddingProvider):
    def __init__(self, model_name: str | None = None):
        try:
            from sentence_transformers import SentenceTransformer
        except ImportError as exc:
            raise RuntimeError(
                "sentence-transformers is not installed — "
                "pip install -r requirements.txt"
            ) from exc
        self.model_name = model_name or settings.embedding_model
        self.model = SentenceTransformer(self.model_name)
        self.dim = int(self.model.get_sentence_embedding_dimension())
        if self.dim != settings.embedding_dim:
            raise RuntimeError(
                f"JSP_EMBEDDING_DIM={settings.embedding_dim} does not match "
                f"the dimension of '{self.model_name}' ({self.dim}). Set "
                f"JSP_EMBEDDING_DIM={self.dim}, recreate/migrate the pgvector "
                "columns, and force a re-embed: python -m app.cli ingest --reembed"
            )

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        # normalize so cosine similarity == dot product, matching how both
        # retrieval legs and the clustering pipeline consume embeddings.
        vectors = self.model.encode(texts, normalize_embeddings=True)
        return [v.tolist() for v in vectors]
