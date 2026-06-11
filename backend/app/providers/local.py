"""Local, deterministic providers. Nothing leaves the machine.

- HashingEmbeddingProvider: feature-hashed character n-gram + word embedding.
  Not state-of-the-art, but deterministic, fast, dependency-light, and good
  enough for retrieval/clustering at prototype scale. Swap for a
  sentence-transformers or in-region API provider via config.

- ExtractiveLLM: a grounded, extractive answer composer. It only ever emits
  text taken from the retrieved passages (plus citation scaffolding), so it
  cannot hallucinate course names, fees, or salaries. It is the safe default
  until the product owner approves a real LLM provider (§11/§14.2).
"""
import hashlib
import math
import re
from typing import Iterator

from .base import EmbeddingProvider, LLMProvider

_WORD_RE = re.compile(r"[a-z0-9']+")

_STOPWORDS = frozenset(
    "a an and are as at be but by can could do does for from has have how i in is it of on or "
    "that the this to want was what when where which who will with you your need needs become "
    "becoming should me my about tell more get".split()
)


def tokenize(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def content_words(text: str) -> list[str]:
    return [w for w in tokenize(text) if w not in _STOPWORDS]


class HashingEmbeddingProvider(EmbeddingProvider):
    def __init__(self, dim: int = 256):
        self.dim = dim

    def _features(self, text: str) -> list[str]:
        words = tokenize(text)
        feats = list(words)
        feats += [f"{a}_{b}" for a, b in zip(words, words[1:])]  # bigrams
        for w in words:  # char trigrams for robustness to morphology/typos
            padded = f"#{w}#"
            feats += [padded[i:i + 3] for i in range(len(padded) - 2)]
        return feats

    def embed(self, texts: list[str]) -> list[list[float]]:
        out = []
        for text in texts:
            vec = [0.0] * self.dim
            for feat in self._features(text):
                h = int.from_bytes(hashlib.md5(feat.encode()).digest()[:8], "big")
                idx = h % self.dim
                sign = 1.0 if (h >> 63) & 1 else -1.0
                vec[idx] += sign
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            out.append([v / norm for v in vec])
        return out


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+|\n+", text)
    return [p.strip() for p in parts if len(p.strip()) > 20]


class ExtractiveLLM(LLMProvider):
    def __init__(self, embedder: EmbeddingProvider | None = None):
        self.embedder = embedder or HashingEmbeddingProvider()

    def _pick_sentences(self, question: str, passage_text: str, n: int = 3) -> list[str]:
        sents = _sentences(passage_text)
        if not sents:
            return []
        qwords = set(content_words(question))
        scored = []
        for i, s in enumerate(sents):
            overlap = len(qwords & set(content_words(s)))
            scored.append((overlap, -i, s))
        scored.sort(reverse=True)
        chosen = [s for _, _, s in scored[:n]]
        # keep original order for readability
        return [s for s in sents if s in chosen]

    def stream_answer(self, system_prompt: str, history: list[dict],
                      question: str, passages: list[dict]) -> Iterator[str]:
        if not passages:
            yield ("I don't have information about that in my sources yet. "
                   "I can help with questions about jobs, skills, careers, and "
                   "training — for example, the skills typically required for a "
                   "role, or training options related to a skill.")
            return
        yield "Here is what the sources say:\n\n"
        seen_urls: list[str] = []
        for p in passages[:3]:
            sents = self._pick_sentences(question, p["text"])
            if not sents:
                continue
            title = p.get("title") or p.get("source_url", "source")
            yield f"**{title}**\n"
            for s in sents:
                yield f"- {s}\n"
            url = p.get("source_url", "")
            if url and url not in seen_urls:
                seen_urls.append(url)
            yield f"\nSource: [{title}]({url})\n\n"
        if not seen_urls:
            yield ("The retrieved sources do not directly answer this. "
                   "Could you rephrase, or ask about a specific job role, "
                   "skill, or training area?")
            return
        yield ("_This answer is composed only from the cited sources. "
               "Details not shown above are not in my sources._")

    def complete(self, prompt: str, max_tokens: int = 256) -> str:
        # Deterministic fallback used for cluster labelling: extract the most
        # frequent content words from the prompt's quoted queries.
        words = content_words(prompt)
        freq: dict[str, int] = {}
        for w in words:
            freq[w] = freq.get(w, 0) + 1
        top = sorted(freq.items(), key=lambda kv: -kv[1])[:4]
        return " / ".join(w for w, _ in top) or "general queries"
