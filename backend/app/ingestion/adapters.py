"""Source adapters (brief §5). API-first; crawler exists but is OFF by default
and refuses to run unless JSP_CRAWL_ENABLED=true (§14.1).

Every adapter yields canonical records:
    {source_url, content_type, title, text}
content_type ∈ {job_role, skill, course, career_pathway, insight_article,
                faq, sector}
"""
import json
import time
import urllib.robotparser
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Iterator

import httpx

from ..config import settings

CONTENT_TYPES = {
    "job_role", "skill", "course", "career_pathway", "insight_article", "faq", "sector",
}


class SourceAdapter(ABC):
    @abstractmethod
    def fetch(self) -> Iterator[dict]:
        ...


class FixtureAdapter(SourceAdapter):
    """Reads the bundled fixture file. Fixture records carry fixture:// URLs so
    they can never be mistaken for real JSP portal content; replace with
    ApiAdapter once the product owner supplies the official feed."""

    def __init__(self, path: str | None = None):
        self.path = Path(path or settings.fixture_path)
        if not self.path.is_absolute():
            self.path = Path(__file__).resolve().parents[2] / self.path

    def fetch(self) -> Iterator[dict]:
        records = json.loads(self.path.read_text())
        for rec in records:
            assert rec["content_type"] in CONTENT_TYPES, rec["content_type"]
            yield rec


class ApiAdapter(SourceAdapter):
    """Reads a structured JSON feed (preferred path). Expects the feed to
    return a list of canonical records, or adapt the mapping below to the
    official feed schema once endpoints/keys are supplied."""

    def fetch(self) -> Iterator[dict]:
        if not settings.api_feed_url:
            raise RuntimeError("JSP_API_FEED_URL is not configured")
        headers = {}
        if settings.api_feed_key:
            headers["Authorization"] = f"Bearer {settings.api_feed_key}"
        r = httpx.get(settings.api_feed_url, headers=headers, timeout=60)
        r.raise_for_status()
        for rec in r.json():
            if rec.get("content_type") in CONTENT_TYPES and rec.get("source_url"):
                yield {
                    "source_url": rec["source_url"],
                    "content_type": rec["content_type"],
                    "title": rec.get("title", rec["source_url"]),
                    "text": rec.get("text", ""),
                }


class CrawlAdapter(SourceAdapter):
    """HTML crawl fallback. Honours robots.txt, descriptive User-Agent,
    rate-limited, and DISABLED unless explicitly enabled by the product owner
    (scraping a public portal may breach ToS — brief §14.1)."""

    def __init__(self, seed_urls: list[str] | None = None):
        self.seed_urls = seed_urls or []

    def _allowed(self, url: str) -> bool:
        from urllib.parse import urlparse
        parsed = urlparse(url)
        rp = urllib.robotparser.RobotFileParser()
        rp.set_url(f"{parsed.scheme}://{parsed.netloc}/robots.txt")
        try:
            rp.read()
        except Exception:
            return False  # fail closed
        return rp.can_fetch(settings.crawl_user_agent, url)

    def fetch(self) -> Iterator[dict]:
        if not settings.crawl_enabled:
            raise RuntimeError(
                "CrawlAdapter is disabled. Confirm ToS with the product owner, "
                "then set JSP_CRAWL_ENABLED=true."
            )
        headers = {"User-Agent": settings.crawl_user_agent}
        for url in self.seed_urls:
            if not self._allowed(url):
                continue
            time.sleep(settings.crawl_rate_limit_seconds)
            r = httpx.get(url, headers=headers, timeout=30, follow_redirects=True)
            if r.status_code != 200:
                continue
            title, text = _extract_html(r.text)
            yield {
                "source_url": url,
                "content_type": "insight_article",  # refine with URL routing rules
                "title": title or url,
                "text": text,
            }


def _extract_html(html: str) -> tuple[str, str]:
    """Minimal tag-stripping extraction; swap in a real parser (trafilatura /
    bs4) when the crawler is actually enabled."""
    import re
    title_m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    title = (title_m.group(1).strip() if title_m else "")
    body = re.sub(r"<(script|style)[^>]*>.*?</\1>", " ", html, flags=re.I | re.S)
    body = re.sub(r"<[^>]+>", " ", body)
    body = re.sub(r"\s+", " ", body).strip()
    return title, body


def get_adapter() -> SourceAdapter:
    if settings.source_adapter == "fixture":
        return FixtureAdapter()
    if settings.source_adapter == "api":
        return ApiAdapter()
    if settings.source_adapter == "crawl":
        return CrawlAdapter()
    raise ValueError(f"Unknown source adapter '{settings.source_adapter}'")
