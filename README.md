# JSP Assistant + JSP Insights

Two web apps over one backend and one data layer:

- **JSP Assistant** (`/`) — a chat app over Jobs–Skills content: RAG answers
  grounded in ingested sources with citations, streaming, email/password
  login, and conversations that persist across logins.
- **JSP Insights** (`/insights`, admin-only) — analytics over what people ask:
  intent classification, job-role/skill/sector entity extraction, unsupervised
  clustering, and dashboards where **every chart drills down to the real
  (PII-redacted) chats**.

## Quick start (Docker)

```bash
cd jsp
cp .env.example .env          # optional; defaults are dev-safe
docker compose up --build -d
docker compose run --rm backend python -m app.cli seed   # one seed command
```

Open http://localhost:3000.

- user: `demo@example.com` / `demo12345`
- admin: `admin@example.com` / `admin12345` (sees JSP Insights)

The seed command ingests the fixture corpus, creates the two accounts, replays
a small set of demo chats, and runs the analytics + clustering batches so all
Insights views have data immediately.

## Quick start (no Docker — SQLite fallback)

```bash
cd jsp/backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m app.cli seed
.venv/bin/uvicorn app.main:app --port 8000
# in another terminal:
cd jsp/web && npm install && npm run dev      # http://localhost:3000
```

Tests (also run against the SQLite fallback, no services needed):

```bash
cd jsp/backend && .venv/bin/python -m pytest tests
```

The suite covers the brief's acceptance criteria (§13): grounded answer with a
working source link surviving logout/login, polite out-of-scope redirect,
delta-only re-ingestion (zero chunks on unchanged re-run), admin drill-down
from cluster to redacted chats, and the consent gate (no `query_analysis`
rows without consent). `tests/test_rag_eval.py` is the RAG eval harness
(gold question → expected source, recall@4) for CI.

## Architecture

```
jsp/
├── docker-compose.yml      Postgres+pgvector · backend · worker · web
├── backend/                FastAPI (Python 3.11)
│   ├── app/
│   │   ├── providers/      LLMProvider / EmbeddingProvider interfaces.
│   │   │                   DEFAULT = local deterministic providers (nothing
│   │   │                   leaves the box). Anthropic adapter is opt-in.
│   │   ├── ingestion/      SourceAdapter (fixture | api | crawl) →
│   │   │                   normalise → heading-aware chunking → embed →
│   │   │                   delta-only upsert (content_hash)
│   │   ├── rag/            hybrid retrieval (vector + keyword, metadata
│   │   │                   filters), §6.1 system prompt verbatim, SSE chat
│   │   ├── analytics/      PII redaction → intent classification → entity
│   │   │                   extraction → clustering (run_id history) →
│   │   │                   2D projection
│   │   ├── routers/        auth · conversations · chat · search · admin
│   │   └── cli.py          seed | ingest | analyze | cluster | scheduler
│   ├── fixtures/           clearly-labelled fixture corpus (fixture:// URLs)
│   └── tests/              23 tests incl. acceptance criteria + RAG evals
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
| LLM zero-shot intent classifier | Keyword/phrase seed classifier by default; `classify_with_llm` engages automatically when a non-local LLM provider is configured | No LLM provider is approved yet (residency flag §11). |

## Decisions intentionally left to the product owner (do not default)

1. **Data source** — currently the clearly-labelled fixture corpus
   (`fixture://` URLs; *not* real JSP content). Supply the official feed via
   `JSP_API_FEED_URL`/`JSP_API_FEED_KEY` and set `JSP_SOURCE_ADAPTER=api`.
   The crawler honours robots.txt + rate limits but **refuses to run** until
   `JSP_CRAWL_ENABLED=true` (confirm ToS first).
2. **LLM / embedding provider & residency** — default `local` providers send
   nothing off-box. The local "LLM" is an extractive grounded composer: it can
   only quote retrieved passages, so it cannot hallucinate. Enabling
   `anthropic` (or adding another adapter) is a one-line config change **after**
   residency approval.
3. **Auth depth** — prototype email/password (argon2 + httpOnly JWT cookie).
   No MFA / verification / SSO; seams noted in `routers/auth.py`.

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
