# Crawl authorization & first-run verification

## Authorization

The product owner has authorized crawling the **public** content of the
Singapore Jobs-Skills Portal (`jobsandskills.skillsfuture.gov.sg`) for this
application (recorded 2026-06-11). The crawler:

- honours `robots.txt` and **fails closed** (robots unreachable → no crawl),
- sends a descriptive User-Agent (`JSP_CRAWL_USER_AGENT`),
- rate-limits requests (`JSP_CRAWL_RATE_LIMIT_SECONDS`, default 2s),
- is restricted to an explicit domain allowlist (`JSP_CRAWL_ALLOWED_DOMAINS`),
- stays **disabled** unless `JSP_CRAWL_ENABLED=true`.

## First-run verification checklist (do this before the first full crawl)

These checks could not be performed from the development environment (the
portal domain was not reachable from the sandbox where this code was written),
so verify them from the machine that will run the crawl:

1. **robots.txt** — `curl https://jobsandskills.skillsfuture.gov.sg/robots.txt`
   Confirm which paths are allowed and record findings below. The crawler
   enforces robots automatically, but knowing the rules up front tells you
   what coverage to expect.
2. **Sitemap** — check `https://jobsandskills.skillsfuture.gov.sg/sitemap.xml`
   (robots.txt often names the sitemap location). If present, set
   `JSP_CRAWL_SITEMAP_URL` — sitemap discovery gives far better coverage than
   seed URLs alone.
3. **Structured feed?** — open the portal with browser dev-tools (Network tab)
   and look for JSON API calls the site's own frontend makes. If a usable feed
   exists, prefer `JSP_SOURCE_ADAPTER=api` with `JSP_API_FEED_URL` over HTML
   scraping — it is more robust and lighter on the site.
4. **Server- or JS-rendered?** — `curl` a few content pages and check whether
   the article text is present in the raw HTML. If pages come back as empty
   app shells, the crawler will skip them (it logs
   `near-empty extraction … likely JS-rendered`). If that happens for most
   pages, a headless-browser fetch (Playwright) is required — that is a
   deliberate, separate decision; do not enable one silently.
5. **Bounded first run** — set `JSP_CRAWL_MAX_PAGES=200` for the first crawl
   to validate extraction quality and content-type routing end to end, then
   raise/remove the cap.
6. **Content-type routing** — after the bounded run, review how URLs mapped to
   content types (`SELECT content_type, COUNT(*) FROM documents GROUP BY 1`)
   and tune `CONTENT_TYPE_RULES` in `backend/app/ingestion/adapters.py` to the
   portal's real URL scheme.

## Findings (fill in after first-run verification)

- robots.txt allows: _TBD_
- Sitemap URL: _TBD_
- Structured feed available: _TBD_
- Rendering: _TBD (server-rendered / JS-rendered)_
