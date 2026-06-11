from functools import lru_cache

from ..config import settings
from .base import EmbeddingProvider, LLMProvider
from .local import ExtractiveLLM, HashingEmbeddingProvider


@lru_cache
def get_embedding_provider() -> EmbeddingProvider:
    if settings.embedding_provider == "local":
        return HashingEmbeddingProvider(dim=settings.embedding_dim)
    raise ValueError(
        f"Unknown embedding provider '{settings.embedding_provider}'. "
        "Add an adapter in app/providers/ and register it here."
    )


@lru_cache
def get_llm_provider() -> LLMProvider:
    if settings.llm_provider == "local":
        return ExtractiveLLM(get_embedding_provider())
    if settings.llm_provider == "anthropic":
        from .anthropic_provider import AnthropicLLM
        return AnthropicLLM()
    raise ValueError(
        f"Unknown LLM provider '{settings.llm_provider}'. "
        "Add an adapter in app/providers/ and register it here."
    )
