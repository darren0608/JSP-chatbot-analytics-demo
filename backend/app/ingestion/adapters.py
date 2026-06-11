"""Source adapters (brief §5). API-first; crawler exists but is OFF by default
and refuses to run unless JSP_CRAWL_ENABLED=true (§14.1).

Every adapter yields canonical records:
    {source_url, content_type, title, text}
content_type ∈ {job_role, skill, course, career_pathway, insight_article,
                faq, sector}
"""
import json
import logging
import time
import urllib.robotparser
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Iterator

import httpx

from ..config import settings

log = logging.getLogger(__name__)

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


# URL→content_type routing for crawled pages. First match on the URL path
# wins; tune to the portal's real URL scheme after the first bounded crawl
# (see docs/CRAWL_AUTHORIZATION.md for the verification checklist).
CONTENT_TYPE_RULES: list[tuple[str, str]] = [
    (r"/faq", "faq"),
    (r"/(jobs?|occupations?|roles?)(/|$)", "job_role"),
    (r"/skills?(/|$)", "skill"),
    (r"/(courses?|training|programmes?|programs?)(/|$)", "course"),
    (r"/(careers?|pathways?|transitions?)(/|$)", "career_pathway"),
    (r"/(sectors?|industr)", "sector"),
]

# Pages shorter than this after extraction are treated as empty shells
# (typically JS-rendered SPAs) and skipped rather than indexed as noise.
MIN_EXTRACTED_CHARS = 200


def route_content_type(url: str) -> str:
    import re
    from urllib.parse import urlparse
    path = urlparse(url).path.lower()
    for pattern, ctype in CONTENT_TYPE_RULES:
        if re.search(pattern, path):
            return ctype
    return "insight_article"


def parse_sitemap(xml_text: str) -> tuple[list[str], list[str]]:
    """Parse a sitemap or sitemap-index document (namespace-agnostic).
    Returns (page_urls, nested_sitemap_urls)."""
    import xml.etree.ElementTree as ET
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return [], []
    pages, sitemaps = [], []
    is_index = root.tag.endswith("sitemapindex")
    for loc in root.iter():
        if loc.tag.endswith("loc") and loc.text:
            (sitemaps if is_index else pages).append(loc.text.strip())
    return pages, sitemaps


class CrawlAdapter(SourceAdapter):
    """HTML crawl of the public portal. Honours robots.txt (fail closed),
    descriptive User-Agent, rate-limited, restricted to allowed domains, and
    DISABLED unless explicitly enabled by the product owner (§14.1).

    URL discovery: a sitemap / sitemap-index (JSP_CRAWL_SITEMAP_URL) plus
    explicit seed URLs (JSP_CRAWL_SEED_URLS). Fetches raw HTML only — pages
    whose content is client-rendered come back near-empty and are skipped
    with a warning (headless-browser fetch is a deliberate non-feature until
    confirmed necessary; see docs/CRAWL_AUTHORIZATION.md)."""

    SITEMAP_MAX_DEPTH = 3

    def __init__(self, seed_urls: list[str] | None = None,
                 sitemap_url: str | None = None,
                 allowed_domains: list[str] | None = None,
                 max_pages: int | None = None):
        self.seed_urls = seed_urls if seed_urls is not None else settings.crawl_seed_url_list
        self.sitemap_url = sitemap_url if sitemap_url is not None else settings.crawl_sitemap_url
        self.allowed_domains = (allowed_domains if allowed_domains is not None
                                else settings.crawl_allowed_domain_list)
        self.max_pages = max_pages if max_pages is not None else settings.crawl_max_pages
        self._robots: dict[str, urllib.robotparser.RobotFileParser | None] = {}

    def _headers(self) -> dict:
        return {"User-Agent": settings.crawl_user_agent}

    def _in_allowed_domain(self, url: str) -> bool:
        from urllib.parse import urlparse
        host = (urlparse(url).hostname or "").lower()
        if not self.allowed_domains:
            return False  # fail closed: an explicit allowlist is required
        return any(host == d.lower() or host.endswith("." + d.lower())
                   for d in self.allowed_domains)

    def _allowed(self, url: str) -> bool:
        """robots.txt check, cached per host, fail closed."""
        from urllib.parse import urlparse
        parsed = urlparse(url)
        if parsed.netloc not in self._robots:
            rp = urllib.robotparser.RobotFileParser()
            rp.set_url(f"{parsed.scheme}://{parsed.netloc}/robots.txt")
            try:
                rp.read()
                self._robots[parsed.netloc] = rp
            except Exception:
                self._robots[parsed.netloc] = None
        rp = self._robots[parsed.netloc]
        if rp is None:
            return False  # robots.txt unreachable → don't crawl
        return rp.can_fetch(settings.crawl_user_agent, url)

    def _sitemap_page_urls(self, sitemap_url: str, depth: int = 0) -> Iterator[str]:
        if depth >= self.SITEMAP_MAX_DEPTH:
            return
        try:
            r = httpx.get(sitemap_url, headers=self._headers(), timeout=30,
                          follow_redirects=True)
        except httpx.HTTPError as exc:
            log.warning("sitemap fetch failed for %s: %s", sitemap_url, exc)
            return
        if r.status_code != 200:
            log.warning("sitemap fetch for %s returned %s", sitemap_url, r.status_code)
            return
        pages, nested = parse_sitemap(r.text)
        yield from pages
        for child in nested:
            yield from self._sitemap_page_urls(child, depth + 1)

    def discover_urls(self) -> list[str]:
        """Sitemap URLs first, then explicit seeds; deduped, domain-filtered,
        capped at max_pages (0 = unlimited)."""
        seen: dict[str, None] = {}

        def _add(url: str) -> bool:
            if url not in seen and self._in_allowed_domain(url):
                seen[url] = None
            return bool(self.max_pages) and len(seen) >= self.max_pages

        if self.sitemap_url:
            for url in self._sitemap_page_urls(self.sitemap_url):
                if _add(url):
                    return list(seen)
        for url in self.seed_urls:
            if _add(url):
                break
        return list(seen)

    def fetch(self) -> Iterator[dict]:
        if not settings.crawl_enabled:
            raise RuntimeError(
                "CrawlAdapter is disabled. Confirm ToS with the product owner, "
                "then set JSP_CRAWL_ENABLED=true."
            )
        skipped_empty = 0
        for url in self.discover_urls():
            if not self._allowed(url):
                log.info("robots.txt disallows %s; skipping", url)
                continue
            time.sleep(settings.crawl_rate_limit_seconds)
            try:
                r = httpx.get(url, headers=self._headers(), timeout=30,
                              follow_redirects=True)
            except httpx.HTTPError as exc:
                log.warning("fetch failed for %s: %s", url, exc)
                continue
            if r.status_code != 200:
                continue
            title, text = extract_html(r.text)
            if len(text) < MIN_EXTRACTED_CHARS:
                skipped_empty += 1
                log.warning("near-empty extraction for %s (%d chars) — likely "
                            "JS-rendered; skipping", url, len(text))
                continue
            yield {
                "source_url": str(r.url),
                "content_type": route_content_type(url),
                "title": title or url,
                "text": text,
            }
        if skipped_empty:
            log.warning(
                "%d page(s) skipped as near-empty. If this is most of the "
                "crawl, the portal is JS-rendered and needs a headless-browser "
                "fetch — see docs/CRAWL_AUTHORIZATION.md before adding one.",
                skipped_empty,
            )


def extract_html(html: str) -> tuple[str, str]:
    """Main-content extraction: trafilatura when available (proper boilerplate
    removal), regex tag-stripping as a last-resort fallback."""
    try:
        import trafilatura
    except ImportError:
        return _extract_html_fallback(html)
    doc = trafilatura.bare_extraction(html, with_metadata=True)
    if doc is None:
        return _extract_html_fallback(html)
    # trafilatura v2 returns a Document object; v1 returned a dict.
    title = getattr(doc, "title", None) if not isinstance(doc, dict) else doc.get("title")
    text = getattr(doc, "text", None) if not isinstance(doc, dict) else doc.get("text")
    if not (text or "").strip():
        return _extract_html_fallback(html)
    return (title or "").strip(), text.strip()


def _extract_html_fallback(html: str) -> tuple[str, str]:
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
