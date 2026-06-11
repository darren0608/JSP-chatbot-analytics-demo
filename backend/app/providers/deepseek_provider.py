"""DeepSeek adapter — OPT-IN ONLY (data residency, brief §11/§14.2).

This provider sends user queries and retrieved passages to DeepSeek's API
(an overseas, China-based provider) — see docs/PROVIDER_DECISION.md for the
recorded approval. Do not enable (JSP_LLM_PROVIDER=deepseek +
JSP_DEEPSEEK_API_KEY) without that sign-off.

DeepSeek exposes an OpenAI-compatible chat-completions API; implemented over
raw HTTP to avoid an SDK dependency, mirroring anthropic_provider.py.
"""
import json
from typing import Iterator

import httpx

from ..config import settings
from .base import LLMProvider


class DeepSeekLLM(LLMProvider):
    def __init__(self):
        if not settings.deepseek_api_key:
            raise RuntimeError("JSP_DEEPSEEK_API_KEY is not set")
        self.url = settings.deepseek_base_url.rstrip("/") + "/chat/completions"
        self.headers = {
            "Authorization": f"Bearer {settings.deepseek_api_key}",
            "content-type": "application/json",
        }

    def _build_messages(self, system_prompt: str, history: list[dict],
                        question: str, passages: list[dict]) -> list[dict]:
        # Same prompt assembly as the Anthropic adapter (verbatim §6.1 system
        # prompt, history, then passages + question) — OpenAI-style APIs carry
        # the system prompt as the first message instead of a separate field.
        context = "\n\n".join(
            f"[Source: {p.get('title','')} | {p.get('source_url','')}]\n{p['text']}"
            for p in passages
        )
        msgs = [{"role": "system", "content": system_prompt}]
        msgs += [{"role": m["role"], "content": m["content"]} for m in history]
        msgs.append({
            "role": "user",
            "content": f"Retrieved passages:\n{context}\n\nUser question: {question}",
        })
        return msgs

    def stream_answer(self, system_prompt, history, question, passages) -> Iterator[str]:
        body = {
            "model": settings.deepseek_model,
            "max_tokens": 1024,
            "messages": self._build_messages(system_prompt, history, question, passages),
            "stream": True,
        }
        with httpx.stream("POST", self.url, headers=self.headers, json=body,
                          timeout=120) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                data = line[6:].strip()
                if data == "[DONE]":
                    break
                try:
                    event = json.loads(data)
                except json.JSONDecodeError:
                    continue
                for choice in event.get("choices", []):
                    text = (choice.get("delta") or {}).get("content")
                    if text:
                        yield text

    def complete(self, prompt: str, max_tokens: int = 256) -> str:
        body = {
            "model": settings.deepseek_model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        r = httpx.post(self.url, headers=self.headers, json=body, timeout=60)
        r.raise_for_status()
        choices = r.json().get("choices") or []
        if not choices:
            return ""
        return (choices[0].get("message") or {}).get("content") or ""
