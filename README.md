# JSP Assistant + JSP Insights

Two web apps over one backend and one data layer:

- **JSP Assistant** (`/`) — a chat app over Jobs–Skills content: RAG answers
  grounded in ingested sources with citations, streaming, email/password
  login, and conversations that persist across logins.
- **JSP Insights** (`/insights`, admin-only) — analytics over what people ask:
  intent classification, job-role/skill/sector entity extraction, unsupervised
  clustering, and dashboards where **every chart drills down to the real
  (PII-redacted) chats**.

## Prerequisites

- **Docker Desktop** (or Docker Engine + the compose plugin) — that's all for
  the Docker paths below. Allow ~10 GB disk for images: the backend image
  includes PyTorch via sentence-transformers.
- Only for the no-Docker fallback: Python 3.11+ and Node 20+.
- Get the code:
  ```bash
  git clone https://github.com/darren0608/JSP-chatbot-analytics-demo.git
  cd JSP-chatbot-analytics-demo
  ```

There are two ways to run the app, both at http://localhost:3000:

| Mode | Data | LLM | Use when |
|---|---|---|---|
| **Demo** (default) | bundled fixtures (`fixture://` URLs) | local extractive, offline | trying the app out |
| **Real** | live crawl of the JSP portal | DeepSeek API | actually using it |

## Run it — demo mode (5 minutes)

```bash
cp .env.example .env          # optional; defaults are dev-safe
docker compose up --build -d  # first build takes a few minutes
docker compose run --rm backend python -m app.cli seed   # one seed command
```

Open http://localhost:3000 and log in:

- user: `demo@example.com` / `demo12345`
- admin: `admin@example.com` / `admin12345` (sees JSP Insights at `/insights`)

The seed command ingests the fixture corpus, creates the two accounts, replays
a small set of demo chats, and runs the analytics + clustering batches so all
Insights views have data immediately.

## Run it — real mode (live crawl + DeepSeek + real embeddings)

Runs entirely on your machine; the only external call is chat generation to
DeepSeek's API. You need a DeepSeek API key. The authorization/decision
records are in `docs/CRAWL_AUTHORIZATION.md` and `docs/PROVIDER_DECISION.md`.

1. **Verify the crawl target first** — work through the first-run checklist
   in `docs/CRAWL_AUTHORIZATION.md` (robots.txt, sitemap location, whether a
   structured feed exists, server- vs JS-rendered). It determines the crawl
   settings below and whether crawling will work at all.
2. **Configure `.env`** — `cp .env.example .env`, then uncomment/fill the
   "real run" blocks (each is marked in the file):
   - fresh `JSP_JWT_SECRET` (generation command is in the file),
   - `JSP_LLM_PROVIDER=deepseek` + `JSP_DEEPSEEK_API_KEY=...`,
   - `JSP_EMBEDDING_PROVIDER=sentence_transformers` + `JSP_EMBEDDING_DIM=384`
     (+ the suggested `JSP_RETRIEVAL_MIN_SCORE` / threshold values),
   - `JSP_SOURCE_ADAPTER=crawl`, `JSP_CRAWL_ENABLED=true`, the sitemap/seed
     URLs from step 1, and `JSP_CRAWL_MAX_PAGES=200` for the first bounded run,
   - your own `JSP_ADMIN_PASSWORD` / `JSP_DEMO_PASSWORD`, and
     `JSP_SEED_DEMO_CHATS=false` unless you want seed-time DeepSeek calls.
3. **Bring it up and seed.** The seed triggers the first crawl — with the
   2s/page rate limit, 200 pages take ≈ 7 minutes; the ~90 MB embedding model
   downloads once into a shared volume:
   ```bash
   docker compose up --build -d
   docker compose run --rm backend python -m app.cli seed
   ```
   Already ran demo mode before? Wipe it first with `docker compose down -v`
   — the database volume holds fixture data and 256-dim embedding columns
   that don't match the new 384-dim model.
4. **Verify**:
   - chunks carry real portal URLs, not `fixture://`:
     `docker compose exec db psql -U jsp -c "SELECT content_type, COUNT(*) FROM documents GROUP BY 1;"`
   - log in at http://localhost:3000 with your admin credentials, ask
     something like "What skills does a data analyst need?", and check the
     answer streams and cites a working portal link,
   - `/insights` loads for the admin account.
5. **Scale up** — review extraction quality and content-type routing (tune
   `CONTENT_TYPE_RULES` in `backend/app/ingestion/adapters.py` if needed),
   then raise/remove `JSP_CRAWL_MAX_PAGES`, recreate the containers (see
   below), and let the worker re-crawl. The worker re-crawls (delta-only) +
   re-runs analytics every 24h.

## Day-to-day operations

```bash
docker compose logs -f backend worker     # watch the crawl / API logs
docker compose down                       # stop (keeps the database)
docker compose down -v                    # stop + WIPE database and model cache
docker compose up -d --force-recreate backend worker   # apply .env changes
docker compose run --rm backend python -m app.cli ingest            # re-crawl now (delta-only)
docker compose run --rm backend python -m app.cli ingest --reembed  # full re-embed (after changing embedder)
```

Note: a plain `restart` does **not** pick up `.env` changes — compose injects
env at container creation, so use `--force-recreate` as above.

## Troubleshooting

- **Port already in use** — the stack binds 3000 (web), 8000 (API), 5432
  (Postgres). Stop whatever holds them or edit the `ports:` mappings in
  `docker-compose.yml`.
- **Crawl ingests 0 documents, logs `near-empty extraction … likely
  JS-rendered`** — the portal pages are client-rendered and the plain HTML
  crawler can't see the content. A headless-browser fetch (Playwright) is the
  fix; that's a deliberate follow-up decision, not a config flag (see
  `docs/CRAWL_AUTHORIZATION.md`).
- **`JSP_EMBEDDING_DIM=... does not match`** on startup — the env dim and the
  model disagree; the error message says which value to set. If the database
  was created under the old dim, `docker compose down -v` and re-seed (or
  migrate the pgvector columns).
- **Answers stop being grounded / chat errors with DeepSeek enabled** — check
  `docker compose logs backend` for API errors (bad key, quota). Setting
  `JSP_LLM_PROVIDER=local` restores the offline extractive answerer
  immediately.

## Quick start (no Docker — SQLite fallback)

Heads-up: `requirements.txt` includes sentence-transformers, so this installs
PyTorch (~2 GB) even though the demo defaults never load it.

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.cli seed
.venv/bin/uvicorn app.main:app --port 8000
# in another terminal:
cd web && npm install && npm run dev      # http://localhost:3000
```

Tests (also run against the SQLite fallback, no services needed):

```bash
cd backend && .venv/bin/python -m pytest tests
```

The suite covers the brief's acceptance criteria (§13): grounded answer with a
working source link surviving logout/login, polite out-of-scope redirect,
delta-only re-ingestion (zero chunks on unchanged re-run), admin drill-down
from cluster to redacted chats, and the consent gate (no `query_analysis`
rows without consent). `tests/test_rag_eval.py` is the RAG eval harness
(gold question → expected source, recall@4) for CI.

## Architecture

```
.
├── docker-compose.yml      Postgres+pgvector · backend · worker · web
├── backend/                FastAPI (Python 3.11)
│   ├── app/
│   │   ├── providers/      LLMProvider / EmbeddingProvider interfaces.
│   │   │                   DEFAULT = local deterministic providers (nothing
│   │   │                   leaves the box). DeepSeek + Anthropic LLM adapters
│   │   │                   and sentence-transformers embeddings are opt-in.
│   │   ├── ingestion/      SourceAdapter (fixture | api | crawl) →
│   │   │                   normalise → heading-aware chunking → embed →
│   │   │                   delta-only upsert (content_hash). Crawler:
│   │   │                   sitemap discovery, robots.txt (fail closed),
│   │   │                   trafilatura extraction, URL→content_type routing.
│   │   ├── rag/            hybrid retrieval (vector + keyword, metadata
│   │   │                   filters), §6.1 system prompt verbatim, SSE chat
│   │   ├── analytics/      PII redaction → intent classification → entity
│   │   │                   extraction → clustering (run_id history) →
│   │   │                   2D projection
│   │   ├── routers/        auth · conversations · chat · search · admin
│   │   └── cli.py          seed | ingest [--reembed] | analyze | cluster | scheduler
│   ├── fixtures/           clearly-labelled fixture corpus (fixture:// URLs)
│   └── tests/              52 tests incl. acceptance criteria + RAG evals
└── web/                    Next.js 14 + TS + Tailwind + Recharts
    ├── app/page.tsx        JSP Assistant (chat, streaming, citations)
    ├── app/login/          signup with PDPA consent toggle
    └── app/insights/       Overview · Intent explorer (scatter + clusters +
                            promote) · Entity explorer (rankings + role×skill
                            heatmap) · Conversation viewer (redacted, annotated)
                            · Content gaps · Taxonomy admin
```

## Data model

Matches brief §8: `users`, `conversations`, `messages`, `documents`,
`chunks(embedding)`, `query_analysis`, `entities`, `clusters`,
`message_cluster`, plus `intent_taxonomy` (editable seed taxonomy; emergent
clusters can be promoted into it). `entities.canonical_id` is the seam for
linking to the official Skills Framework taxonomy when supplied. On Postgres,
embedding columns are real `pgvector` columns; on the SQLite dev fallback they
are JSON and similarity runs in NumPy.

## Deliberate deviations from the brief (with rationale)

| Brief said | Built | Why |
|---|---|---|
| Two Next.js apps + shared lib | One Next.js app, two route groups (`/` and `/insights`) | One deployment and one session cookie at prototype scale; RBAC separates them; splitting later is mechanical (shared `lib/` + `components/` already isolated). |
| RQ/Celery worker queue | `app/cli.py` batch commands + a scheduler loop container | Avoids a Redis dependency; batch functions are pure `fn(db) -> stats` so wrapping them in RQ/Celery tasks later requires no changes. |
| sentence-transformers / HDBSCAN / UMAP / BERTopic | Hashing embeddings, greedy cosine leader-clustering, PCA projection (all NumPy) | Keeps the default install light and fully offline. Each sits behind an interface (`EmbeddingProvider`, `cluster_embeddings`, `project_2d`) — swap in the heavy ML stack without touching callers. Thresholds are config (`JSP_CLUSTER_SIMILARITY_THRESHOLD`). |
| LLM zero-shot intent classifier | Keyword/phrase seed classifier by default; `classify_with_llm` engages automatically when a non-local LLM provider is configured | Engages once a real provider (e.g. DeepSeek) is enabled. |

## Product-owner decisions (status)

1. **Data source** — crawling the public portal is **authorized**
   (`docs/CRAWL_AUTHORIZATION.md`); ship defaults stay on the fixture corpus
   (`fixture://` URLs) until you opt in via `.env`. If an official feed
   exists, prefer it: `JSP_API_FEED_URL`/`JSP_API_FEED_KEY` +
   `JSP_SOURCE_ADAPTER=api`. The crawler honours robots.txt + rate limits and
   **refuses to run** unless `JSP_CRAWL_ENABLED=true`.
2. **LLM / embedding provider & residency** — **DeepSeek is the approved chat
   LLM** (`docs/PROVIDER_DECISION.md`); embeddings stay on-box
   (sentence-transformers). Ship defaults remain fully `local`: the local
   "LLM" is an extractive grounded composer that can only quote retrieved
   passages, so it cannot hallucinate — and it's the instant fallback
   (`JSP_LLM_PROVIDER=local`) if the provider decision changes.
3. **Auth depth** — prototype email/password (argon2 + httpOnly JWT cookie).
   No MFA / verification / SSO; seams noted in `routers/auth.py`. Don't
   expose this beyond localhost/LAN without revisiting it.

## PDPA / governance built in

- Consent toggle at sign-up (`users.consent_analytics`); non-consenting users
  produce **zero** analytics rows (tested). Consent is changeable via
  `PATCH /api/auth/consent`.
- PII redaction (emails, NRIC/FIN, phones, long numbers, name
  self-introductions) before anything is stored in `query_analysis` or shown
  in any Insights view.
- Account deletion hard-deletes the user and cascades chats + analytics.
- Per-user chat rate limiting; RBAC on all `/api/admin/*` routes; secrets via
  env only.

## Operations

- Re-index: `python -m app.cli ingest` (delta-only via `content_hash`;
  re-running with unchanged sources upserts zero chunks). The `worker`
  container runs ingest + analyze + cluster on a configurable interval.
- Analytics batches: `python -m app.cli analyze` / `cluster` — idempotent;
  each clustering run gets a `run_id`, history is kept for trend comparison.
- Admins can also trigger all three from the Insights → Overview page.
