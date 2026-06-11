"""Anthropic adapter — OPT-IN ONLY (data residency, brief §11/§14.2).

This provider sends user queries and retrieved passages to the Anthropic API.
Do not enable (JSP_LLM_PROVIDER=anthropic + JSP_ANTHROPIC_API_KEY) until the
product owner has confirmed the provider and region are approved.
Implemented over raw HTTP to avoid an SDK dependency.
"""
import json
from typing import Iterator

import httpx

from ..config import settings
from .base import LLMProvider

API_URL = "https://api.anthropic.com/v1/messages"


class AnthropicLLM(LLMProvider):
    def __init__(self):
        if not settings.anthropic_api_key:
            raise RuntimeError("JSP_ANTHROPIC_API_KEY is not set")
        self.headers = {
            "x-api-key": settings.anthropic_api_key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
        }

    def _build_messages(self, history: list[dict], question: str, passages: list[dict]) -> list[dict]:
        context = "\n\n".join(
            f"[Source: {p.get('title','')} | {p.get('source_url','')}]\n{p['text']}"
            for p in passages
        )
        msgs = [{"role": m["role"], "content": m["content"]} for m in history]
        msgs.append({
            "role": "user",
            "content": f"Retrieved passages:\n{context}\n\nUser question: {question}",
        })
        return msgs

    def stream_answer(self, system_prompt, history, question, passages) -> Iterator[str]:
        body = {
            "model": settings.anthropic_model,
            "max_tokens": 1024,
            "system": system_prompt,
            "messages": self._build_messages(history, question, passages),
            "stream": True,
        }
        with httpx.stream("POST", API_URL, headers=self.headers, json=body, timeout=120) as r:
            r.raise_for_status()
            for line in r.iter_lines():
                if not line.startswith("data: "):
                    continue
                try:
                    event = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue
                if event.get("type") == "content_block_delta":
                    delta = event.get("delta", {})
                    if delta.get("type") == "text_delta":
                        yield delta.get("text", "")

    def complete(self, prompt: str, max_tokens: int = 256) -> str:
        body = {
            "model": settings.anthropic_model,
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}],
        }
        r = httpx.post(API_URL, headers=self.headers, json=body, timeout=60)
        r.raise_for_status()
        data = r.json()
        return "".join(b.get("text", "") for b in data.get("content", []))
