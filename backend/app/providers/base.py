"""Provider interfaces (brief §3, §11).

Both the LLM and the embedding model sit behind these interfaces so an
in-region / on-prem model can be dropped in without touching the rest of the
system. The DEFAULT is the local deterministic provider — no user query or
ingested content leaves the deployment until the product owner explicitly
approves an external provider (set JSP_LLM_PROVIDER / JSP_EMBEDDING_PROVIDER).
"""
from abc import ABC, abstractmethod
from typing import Iterator


class EmbeddingProvider(ABC):
    dim: int

    @abstractmethod
    def embed(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding per input text."""

    def embed_one(self, text: str) -> list[float]:
        return self.embed([text])[0]


class LLMProvider(ABC):
    @abstractmethod
    def stream_answer(self, system_prompt: str, history: list[dict],
                      question: str, passages: list[dict]) -> Iterator[str]:
        """Stream an answer grounded ONLY in `passages`
        (each: {text, source_url, title, score})."""

    @abstractmethod
    def complete(self, prompt: str, max_tokens: int = 256) -> str:
        """Single-shot completion (used by intent classification and
        cluster labelling)."""
