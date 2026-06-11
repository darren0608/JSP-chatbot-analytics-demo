# LLM / embedding provider decision record

Per the brief (§11/§14.2) and the README, enabling any non-local provider is
an explicit product-owner decision. This file records it.

## Decision (2026-06-11)

| Concern | Decision |
|---|---|
| Answer generation (LLM) | **DeepSeek** (`JSP_LLM_PROVIDER=deepseek`, model `deepseek-chat`) |
| Embeddings | **Local sentence-transformers** (`all-MiniLM-L6-v2`) — runs on-box; the corpus and queries are never sent to an embeddings API |
| Fallback | The local `ExtractiveLLM` remains available (`JSP_LLM_PROVIDER=local`) if DeepSeek is unreachable or the decision is reversed |

## What leaves the deployment, and to whom

When DeepSeek is enabled, **each chat turn sends to DeepSeek's API** (an
overseas, China-based provider):

- the user's question and recent conversation history,
- the retrieved portal passages used as grounding context.

What does **not** leave the deployment: the crawled corpus as a whole, the
vector index, user accounts, analytics (intents/entities/clusters), and the
JSP Insights views — embeddings and analytics are fully local.

## Conditions

- Approved by the product owner for **public portal content + user chat
  queries only**. Re-confirm before ingesting any non-public source.
- The API key is supplied via `JSP_DEEPSEEK_API_KEY` (env only, never
  committed).
- PII redaction applies to analytics storage, but raw user queries are sent
  to the LLM at chat time — the in-app prompt instructs users' personal
  details not be repeated, and the system prompt forbids retaining them.
- Reversal path: set `JSP_LLM_PROVIDER=local` (no code change).
