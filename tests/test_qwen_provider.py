from __future__ import annotations

from types import SimpleNamespace

import httpx
import config

from base_agent import QwenAPIError, _QwenCompletions, classify_llm_exception


class _FakeHTTPClient:
    def __init__(self, response):
        self.response = response
        self.calls: list[dict] = []

    def post(self, endpoint, *, headers, json):
        self.calls.append({"endpoint": endpoint, "headers": headers, "json": json})
        return self.response


def _response(payload, status_code=200):
    return SimpleNamespace(status_code=status_code, json=lambda: payload)


def test_qwen_adapter_maps_openai_compatible_response_and_thinking(monkeypatch):
    client = _FakeHTTPClient(
        _response(
            {
                "choices": [{"message": {"content": '{"ok":true}'}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5},
            }
        )
    )
    monkeypatch.setattr(httpx, "Client", lambda **_kwargs: client)
    completions = _QwenCompletions(
        api_key="test-key",
        base_url="https://dashscope.example/compatible-mode/v1",
        timeout=5,
    )

    result = completions.create(
        model="qwen-plus",
        messages=[{"role": "user", "content": "hi"}],
        response_format={"type": "json_object"},
        thinking={"type": "disabled"},
    )

    assert result.choices[0].message.content == '{"ok":true}'
    assert result.usage["total_tokens"] == 5
    request = client.calls[0]
    assert request["endpoint"].endswith("/chat/completions")
    assert request["headers"]["Authorization"] == "Bearer test-key"
    assert request["json"]["enable_thinking"] is False
    assert "thinking" not in request["json"]


def test_qwen_adapter_classifies_timeout_and_http_status():
    assert classify_llm_exception(QwenAPIError("Qwen request timed out"))[:2] == (
        "model_timeout",
        504,
    )
    assert classify_llm_exception(QwenAPIError("invalid key", status_code=401))[:2] == (
        "model_auth_failed",
        502,
    )


def test_qwen_adapter_reports_missing_key_before_network(monkeypatch):
    monkeypatch.setattr(httpx, "Client", lambda **_kwargs: _FakeHTTPClient(None))
    completions = _QwenCompletions(
        api_key="",
        base_url="https://dashscope.example/compatible-mode/v1",
        timeout=5,
    )

    try:
        completions.create(model="qwen-plus", messages=[])
    except QwenAPIError as error:
        assert classify_llm_exception(error)[:2] == ("model_auth_failed", 502)
    else:  # pragma: no cover - defensive assertion for the negative contract.
        raise AssertionError("missing Qwen key must fail before network")


def test_runtime_model_settings_switch_provider_without_exposing_key(monkeypatch):
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("ZHIPU_API_KEY", raising=False)
    config.reset_runtime_model_config()
    try:
        qwen = config.configure_model(
            "qwen",
            api_key="qwen-test-key",
            model="qwen-test-model",
            base_url="https://qwen.example/v1",
        )
        assert qwen["provider"] == "qwen"
        assert qwen["model"] == "qwen-test-model"
        assert qwen["api_key"] == "qwen-test-key"
        public = config.public_model_config()
        assert public["has_api_key"] is True
        assert "api_key" not in public

        zhipu = config.configure_model(
            "zhipu",
            api_key="zhipu-test-key",
            model="glm-test-model",
            base_url="https://zhipu.example/v4",
        )
        assert zhipu["provider"] == "zhipu"
        assert zhipu["model"] == "glm-test-model"
        assert zhipu["api_key"] == "zhipu-test-key"
    finally:
        config.reset_runtime_model_config()
