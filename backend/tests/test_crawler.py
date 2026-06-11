"""Crawler unit tests — no network. Covers the §14.1 enable gate, sitemap
parsing (urlset + index recursion), content_type routing, domain allowlist,
max_pages cap, and the JS-shell skip in fetch()."""
import pytest

from app.config import settings
from app.ingestion.adapters import (
    CrawlAdapter, extract_html, parse_sitemap, route_content_type,
)

DOMAIN = "jobsandskills.skillsfuture.gov.sg"
BASE = f"https://{DOMAIN}"

URLSET_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{BASE}/jobs/data-analyst</loc></url>
  <url><loc>{BASE}/skills/sql</loc></url>
</urlset>"""

INDEX_XML = f"""<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>{BASE}/sitemap-jobs.xml</loc></sitemap>
  <sitemap><loc>{BASE}/sitemap-skills.xml</loc></sitemap>
</sitemapindex>"""


def test_crawler_refuses_when_disabled():
    assert settings.crawl_enabled is False  # safe default
    adapter = CrawlAdapter(seed_urls=[f"{BASE}/jobs"])
    with pytest.raises(RuntimeError, match="JSP_CRAWL_ENABLED"):
        list(adapter.fetch())


def test_parse_sitemap_urlset():
    pages, sitemaps = parse_sitemap(URLSET_XML)
    assert pages == [f"{BASE}/jobs/data-analyst", f"{BASE}/skills/sql"]
    assert sitemaps == []


def test_parse_sitemap_index():
    pages, sitemaps = parse_sitemap(INDEX_XML)
    assert pages == []
    assert sitemaps == [f"{BASE}/sitemap-jobs.xml", f"{BASE}/sitemap-skills.xml"]


def test_parse_sitemap_garbage_is_empty():
    assert parse_sitemap("not xml at all") == ([], [])


@pytest.mark.parametrize("url,expected", [
    (f"{BASE}/jobs/data-analyst", "job_role"),
    (f"{BASE}/occupations/nurse", "job_role"),
    (f"{BASE}/skills/python", "skill"),
    (f"{BASE}/courses/sql-101", "course"),
    (f"{BASE}/training/cyber", "course"),
    (f"{BASE}/careers/switch-guide", "career_pathway"),
    (f"{BASE}/sectors/infocomm", "sector"),
    (f"{BASE}/jobs/faq", "faq"),                 # faq outranks job
    (f"{BASE}/articles/outlook-2026", "insight_article"),  # default
])
def test_route_content_type(url, expected):
    assert route_content_type(url) == expected


def test_discover_urls_filters_domain_and_caps(monkeypatch):
    adapter = CrawlAdapter(
        seed_urls=[
            f"{BASE}/jobs/a",
            "https://evil.example.com/jobs/b",   # outside allowlist
            f"https://sub.{DOMAIN}/jobs/c",      # subdomain allowed
            f"{BASE}/jobs/d",
        ],
        sitemap_url="",
        allowed_domains=[DOMAIN],
        max_pages=2,
    )
    urls = adapter.discover_urls()
    assert urls == [f"{BASE}/jobs/a", f"https://sub.{DOMAIN}/jobs/c"]


def test_discover_urls_empty_allowlist_fails_closed():
    adapter = CrawlAdapter(seed_urls=[f"{BASE}/jobs/a"], sitemap_url="",
                           allowed_domains=[], max_pages=0)
    assert adapter.discover_urls() == []


def test_discover_urls_recurses_sitemap_index(monkeypatch):
    fetched = []

    def fake_get(url, **kwargs):
        fetched.append(url)

        class R:
            status_code = 200
            text = INDEX_XML if url.endswith("sitemap.xml") else URLSET_XML
        return R()

    monkeypatch.setattr("app.ingestion.adapters.httpx.get", fake_get)
    adapter = CrawlAdapter(seed_urls=[], sitemap_url=f"{BASE}/sitemap.xml",
                           allowed_domains=[DOMAIN], max_pages=0)
    urls = adapter.discover_urls()
    assert f"{BASE}/sitemap-jobs.xml" in fetched
    assert f"{BASE}/sitemap-skills.xml" in fetched
    # two children × two pages, deduped to the two distinct page URLs
    assert set(urls) == {f"{BASE}/jobs/data-analyst", f"{BASE}/skills/sql"}


REAL_PAGE = """<html><head><title>Data Analyst | JSP</title></head><body>
<main><h1>Data Analyst</h1>""" + "".join(
    f"<p>Data analysts interpret datasets to answer business questions, "
    f"using SQL, statistics, and visualisation tools. Paragraph {i}.</p>"
    for i in range(5)
) + "</main></body></html>"

EMPTY_SHELL = '<html><head><title>JSP</title></head><body><div id="root"></div></body></html>'


def test_fetch_extracts_routes_and_skips_shells(monkeypatch):
    monkeypatch.setattr(settings, "crawl_enabled", True)
    monkeypatch.setattr(settings, "crawl_rate_limit_seconds", 0.0)
    monkeypatch.setattr(CrawlAdapter, "_allowed", lambda self, url: True)

    def fake_get(url, **kwargs):
        class R:
            status_code = 200
            text = EMPTY_SHELL if "spa-page" in url else REAL_PAGE
        R.url = url
        return R()

    monkeypatch.setattr("app.ingestion.adapters.httpx.get", fake_get)
    adapter = CrawlAdapter(
        seed_urls=[f"{BASE}/jobs/data-analyst", f"{BASE}/spa-page"],
        sitemap_url="", allowed_domains=[DOMAIN], max_pages=0,
    )
    records = list(adapter.fetch())
    assert len(records) == 1  # the JS shell was skipped
    rec = records[0]
    assert rec["content_type"] == "job_role"
    assert rec["title"].startswith("Data Analyst")
    assert "SQL" in rec["text"]
    assert "<p>" not in rec["text"]


def test_fetch_respects_robots_disallow(monkeypatch):
    monkeypatch.setattr(settings, "crawl_enabled", True)
    monkeypatch.setattr(settings, "crawl_rate_limit_seconds", 0.0)
    monkeypatch.setattr(CrawlAdapter, "_allowed", lambda self, url: False)
    adapter = CrawlAdapter(seed_urls=[f"{BASE}/jobs/a"], sitemap_url="",
                           allowed_domains=[DOMAIN], max_pages=0)
    assert list(adapter.fetch()) == []


def test_extract_html_fallback_strips_tags():
    from app.ingestion.adapters import _extract_html_fallback
    title, text = _extract_html_fallback(REAL_PAGE)
    assert title == "Data Analyst | JSP"
    assert "SQL" in text and "<" not in text
