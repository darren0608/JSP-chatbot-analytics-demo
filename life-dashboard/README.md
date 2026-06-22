# Life Dashboard v2

A single-user, self-hosted **personal life dashboard**. It aggregates your
calendar, tasks, and finances into one private web view — plus a two-way
**Telegram assistant** for capture and queries on the go.

Built on **Google Apps Script** (V8) with **one Google Sheet as the datastore**.
It runs beautifully with **zero credentials** (full mock dataset) and lights up
each section live as you add credentials.

> **New here / taking this over?** Start with
> **[docs/HANDOVER.md](docs/HANDOVER.md)** — a plain-language guide (no coding
> needed) to what the key functions do, how each is triggered, where your data
> and secrets live, and what to do when something looks wrong.

> **Note on layout.** This was scaffolded as a self-contained project inside the
> `life-dashboard/` directory so it can be lifted straight into its own repo:
> everything it needs (source, tests, CI, docs) lives here and nothing depends on
> the parent repository.

---

## Why you might want it

- **One screen for the 5 things you check daily** — agenda, top tasks, overdue
  count, next bill, habit streaks, and a one-line AI briefing.
- **Private by design.** Personal account only. Your work/government calendar can
  appear *only* as title-less "Busy" blocks — never its event details.
- **Graceful.** Any one integration can fail without breaking the page; the rest
  keeps its last-good data and shows a small warning chip.
- **Read-only money.** Finance integrations never execute trades or move money.

## Features

| Area | What you get |
|------|--------------|
| **Home** | Greeting, date, today's agenda, top 3 tasks, overdue count, next bill, habit rings, one-line AI/templated briefing. |
| **Time** | 7-day merged timeline (calendar + timed tasks) + untimed follow-ups; overdue flagged; work/gov shown only as "Busy". |
| **Tasks** | Open tasks from your Sheet + TickTick; add / complete / reopen / soft-delete; source badges; audited writes. |
| **Money** | Total portfolio, est. annual dividends, SRS balance + remaining top-up room, CPF total; holdings table; IBKR Flex auto-pull. |
| **More** | Habits & streaks, Bills & subscriptions, Goals, Countdowns, Notes, global search, Settings + diagnostics. |
| **Telegram** | Quick capture + queries (today / overdue / portfolio / SRS / birthdays …), yes/no confirmation for destructive actions, polling (no fragile webhook). |
| **Design** | Token-driven design system, light/dark + system, mobile-first PWA-friendly layout, accessible components. |

## Architecture

```
src/
  Code.gs        web entrypoints (doGet/doPost), state assembly, last-good cache, API wrappers
  config.gs      SHEET_ID, cfgGet/Set/IsSet, credential registry, settings, full mock dataset
  util.gs        pure helpers (dates, money, ids, tryOr, per-exec memo) — no Google calls
  cache.gs       CacheService caching (state/briefing/FX) + cache-bust — the main cost/quota lever
  store.gs       header-driven Google Sheet wrapper (the ONLY SpreadsheetApp user) + LockService
  log.gs         append-only audit log
  errors.gs      observability: rate-limited error capture + weekly Telegram health digest
  fx.gs          FX→SGD rates as data (Sheet/free feed, cached) with constant fallback
  maintenance.gs daily housekeeping: compact overrides, prune errors, refresh FX
  tasks.gs       task CRUD + Sheet/TickTick merge + soft-delete + override handling
  ticktick.gs    TickTick Open API client
  calendar.gs    Google Calendar reads + Time tab timeline merge (free/busy for work/gov)
  ibkr.gs        IBKR Flex Web Service two-step pull (replaces only IBKR rows)
  finances.gs    summary-card math + holdings/dividends assembly
  habits.gs bills.gs goals.gs notes.gs countdowns.gs   new life-dashboard modules
  nlp.gs         NL → command parser (AI first, regex fallback always)
  ai.gs          Gemini via Vertex REST (UrlFetchApp + getOAuthToken)
  capture.gs     quick-capture routing + query answering (shared by UI and bot)
  telegram.gs    polling bot, update_id dedup, whitelist, confirmation flow, reminders
  briefing.gs    daily/weekly briefing (AI or templated) + Telegram push
  search.gs      global search across tasks/events/notes/holdings
  settings.gs    settings screen backend + credential status (read-only secrets)
  diagnose.gs    one-click per-integration self-check
  dashboard.html single-file frontend (tokens → reset → layout → components)
  appsscript.json manifest (V8, scopes, web-app config)
tests/           run.js (suite), harness.js (vm loader), mocks.js (Google fakes)
docs/            DEPLOY.md, STYLE_GUIDE.md
```

### Design principles baked in (hard-won from v1)
- The sandboxed HTML talks to the server **only** via `google.script.run`.
- Every server entrypoint returns a **valid object even on throw** (a thrown
  function silently delivers `null` to the client) — the client null-guards too.
- `doPost` never throws (an uncaught throw → 302 redirect that breaks JSON).
- Telegram uses **polling**, not webhooks (Apps Script `/exec` bounces external
  POSTs with 302); updates are **deduplicated by `update_id`**.
- Vertex AI is called via its **REST endpoint** (not the fragile advanced
  service), and there's always a **regex fallback** parser.

## Running the tests

```bash
cd life-dashboard
npm test
```

Fast, deterministic, dependency-light: every Google service is mocked in a `vm`
sandbox (`tests/mocks.js`), the clock is pinned, and the runner exits non-zero on
any failure. CI runs the same command (`.github/workflows/test.yml`).

Current coverage: rendering/state (mock/live/degraded, null-safe entrypoints),
tasks (incl. the complete-then-delete TickTick regression, soft-delete + audit,
locking), timeline (chronology, overdue, no gov-title leak, follow-ups),
finances (summary math, IBKR replace-only refresh, busy guard, missing creds),
Telegram (whitelist, secret, dedup, NL+regex, confirmation, query handlers),
the new modules (habits/bills/goals/countdowns/capture), and meta
(manifest + `diagnose()`).

## Setup & deploy

See **[docs/DEPLOY.md](docs/DEPLOY.md)** for the non-technical, step-by-step
guide: deploy with zero credentials first, then add each secret to light up
sections one at a time, enable the Telegram bot (polling) and the AI parser, and
point the app at your own Sheet.

## Design system

See **[docs/STYLE_GUIDE.md](docs/STYLE_GUIDE.md)** for the token table and the
component gallery.
