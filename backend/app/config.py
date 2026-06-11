"""Application configuration.

All deployment-sensitive choices (database, LLM/embedding provider, crawling)
are env-driven. Defaults are chosen to be safe:
  - local deterministic providers (no data leaves the deployment),
  - crawler disabled,
  - SQLite fallback so the app runs without Docker for development/tests.
"""
from functools import lru_cache

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    app_name: str = "JSP Platform"
    # Postgres (+pgvector) in docker compose; sqlite fallback for local dev/tests.
    database_url: str = "sqlite:///./jsp_dev.db"

    # Auth
    jwt_secret: str = "dev-only-secret-change-me-0123456789abcdef"  # >=32 bytes; override in prod
    jwt_algorithm: str = "HS256"
    jwt_ttl_hours: int = 24 * 7
    cookie_name: str = "jsp_session"
    cookie_secure: bool = False  # set true behind HTTPS

    # Providers. "local" sends nothing off-box. External providers (e.g.
    # "anthropic") must be explicitly approved for data residency (§11).
    llm_provider: str = "local"
    embedding_provider: str = "local"
    embedding_dim: int = 256
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-6"

    # Ingestion
    source_adapter: str = "fixture"  # fixture | api | crawl
    fixture_path: str = "fixtures/sample_content.json"
    api_feed_url: str = ""
    api_feed_key: str = ""
    crawl_enabled: bool = False  # CrawlAdapter refuses to run unless true
    crawl_user_agent: str = "JSPAssistantBot/0.1 (+contact: product owner)"
    crawl_rate_limit_seconds: float = 2.0
    # URL discovery for the crawler. Comma-separated env values; parsed lists
    # are exposed via the *_list properties below.
    crawl_seed_urls: str = ""    # JSP_CRAWL_SEED_URLS
    crawl_sitemap_url: str = ""  # JSP_CRAWL_SITEMAP_URL (sitemap.xml or index)
    crawl_allowed_domains: str = "jobsandskills.skillsfuture.gov.sg"
    crawl_max_pages: int = 0     # 0 = unlimited; set a few hundred for first runs

    # RAG
    retrieval_top_k: int = 6
    retrieval_min_score: float = 0.18  # below this => content-gap signal
    chunk_target_tokens: int = 650

    # Chat rate limit (per user)
    chat_rate_limit_per_minute: int = 20

    # Analytics
    cluster_min_size: int = 2
    # Tuned for the local hashing embeddings: paraphrases score ~0.5+, unrelated
    # queries < 0.3. Re-tune when swapping the embedding provider.
    cluster_similarity_threshold: float = 0.40

    seed_on_start: bool = False

    class Config:
        env_file = ".env"
        env_prefix = "JSP_"

    @staticmethod
    def _split_csv(value: str) -> list[str]:
        return [v.strip() for v in value.split(",") if v.strip()]

    @property
    def crawl_seed_url_list(self) -> list[str]:
        return self._split_csv(self.crawl_seed_urls)

    @property
    def crawl_allowed_domain_list(self) -> list[str]:
        return self._split_csv(self.crawl_allowed_domains)


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
