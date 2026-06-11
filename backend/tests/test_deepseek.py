"""DeepSeek provider tests — httpx is faked; no network, no API key leaves
the test process."""
import json

import pytest

from app.config import settings
from app.providers import get_llm_provider

PASSAGES = [{"title": "Data Analyst", "source_url": "https://example.gov.sg/jobs/da",
             "text": "Data analysts use SQL.", "score": 0.9}]


@pytest.fixture()
def deepseek(monkeypatch):
    monkeypatch.setattr(settings, "deepseek_api_key", "test-key")
    from app.providers.deepseek_provider import DeepSeekLLM
    return DeepSeekLLM()


def test_requires_api_key():
    from app.providers.deepseek_provider import DeepSeekLLM
    assert settings.deepseek_api_key == ""
    with pytest.raises(RuntimeError, match="JSP_DEEPSEEK_API_KEY"):
        DeepSeekLLM()


def test_factory_registers_deepseek(monkeypatch):
    monkeypatch.setattr(settings, "llm_provider", "deepseek")
    monkeypatch.setattr(settings, "deepseek_api_key", "test-key")
    get_llm_provider.cache_clear()
    try:
        from app.providers.deepseek_provider import DeepSeekLLM
        assert isinstance(get_llm_provider(), DeepSeekLLM)
    finally:
        get_llm_provider.cache_clear()


def test_build_messages_shape(deepseek):
    msgs = deepseek._build_messages(
        "SYSTEM PROMPT", [{"role": "user", "content": "hi"},
                          {"role": "assistant", "content": "hello"}],
        "What does a data analyst do?", PASSAGES)
    assert msgs[0] == {"role": "system", "content": "SYSTEM PROMPT"}
    assert msgs[1]["role"] == "user" and msgs[2]["role"] == "assistant"
    final = msgs[-1]
    assert final["role"] == "user"
    assert "https://example.gov.sg/jobs/da" in final["content"]
    assert "What does a data analyst do?" in final["content"]


def _sse(payload: dict) -> str:
    return "data: " + json.dumps(payload)


def test_stream_answer_parses_sse(deepseek, monkeypatch):
    captured = {}

    class FakeStream:
        def __init__(self, method, url, headers=None, json=None, timeout=None):
            captured.update(url=url, headers=headers, body=json)

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def raise_for_status(self):
            pass

        def iter_lines(self):
            yield _sse({"choices": [{"delta": {"role": "assistant"}}]})  # no content
            yield _sse({"choices": [{"delta": {"content": "Data "}}]})
            yield ""  # keep-alive blank line
            yield _sse({"choices": [{"delta": {"content": "analysts use SQL."}}]})
            yield "data: [DONE]"
            yield _sse({"choices": [{"delta": {"content": "AFTER-DONE"}}]})

    monkeypatch.setattr("app.providers.deepseek_provider.httpx.stream", FakeStream)
    out = "".join(deepseek.stream_answer("SYS", [], "question?", PASSAGES))
    assert out == "Data analysts use SQL."
    assert captured["url"] == "https://api.deepseek.com/chat/completions"
    assert captured["headers"]["Authorization"] == "Bearer test-key"
    assert captured["body"]["model"] == "deepseek-chat"
    assert captured["body"]["stream"] is True
    assert captured["body"]["messages"][0]["role"] == "system"


def test_complete_parses_choice(deepseek, monkeypatch):
    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return {"choices": [{"message": {"content": "sql / analyst"}}]}

    monkeypatch.setattr("app.providers.deepseek_provider.httpx.post",
                        lambda *a, **k: FakeResponse())
    assert deepseek.complete("label these") == "sql / analyst"
