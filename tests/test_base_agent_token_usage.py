from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import json
from types import SimpleNamespace

import pytest

from base_agent import BaseAgent, LLMCallFailure, classify_llm_exception


class DummyAgent(BaseAgent):
    def process(self, input_data):
        return input_data


def test_parse_json_response_repeats_bounded_delimiter_repair():
    """一个响应包含多个缺失逗号时，沿用同一有界解析回退逐个修复。"""

    agent = DummyAgent("json-repair")
    malformed = '{"a": {"b": 1 "c": 2} "d": 3}'

    assert agent.parse_json_response(malformed) == {
        "a": {"b": 1, "c": 2},
        "d": 3,
    }


@pytest.mark.parametrize("wrapper", ["plain", "fenced", "trailing_comma", "missing_comma"])
def test_json_repair_preserves_every_string_value(wrapper):
    parser = object.__new__(DummyAgent)
    expected = {"text": '记录原文：,}；,]；"称呼"；\\path\n下一行',
                "nested": ["[,}]", {"value": "原文, ]"}]}
    response = json.dumps(expected, ensure_ascii=False)
    if wrapper == "fenced":
        response = "```json\n" + response + "\n```"
    elif wrapper == "trailing_comma":
        response = response[:-1] + ",}"
    elif wrapper == "missing_comma":
        response = response.replace(', "nested":', ' "nested":')
    assert parser.parse_json_response(response) == expected


def test_json_repair_keeps_raw_control_characters_without_guessing_quotes():
    parser = object.__new__(DummyAgent)
    assert parser.parse_json_response('{"text":"第一行\n第二行",}') == {"text": "第一行\n第二行"}
    response = '{"text":"left "right" end"}'
    assert parser.parse_json_response(response).get("parse_error") is True


def test_json_repair_preserves_nested_raw_controls_and_bounded_attempts():
    parser = object.__new__(DummyAgent)
    expected = {"items": ["第一行\n第二行", {"text": 'tab\t原文,]；\\；"引号"'}]}
    response = json.dumps(expected, ensure_ascii=False).replace("\\n", "\n").replace("\\t", "\t")
    assert parser.parse_json_response(response[:-1] + ",}") == expected
    assert parser.parse_json_response('{"a":1 "b":2 "c":3 "d":4 "e":5}').get("parse_error") is True


def test_global_token_history_is_bounded_without_truncating_request_capture():
    parser = object.__new__(DummyAgent)
    parser.name, parser.model = "history-test", "fake-model"
    with BaseAgent.capture_token_usage() as records:
        for index in range(10005):
            parser._record_token_usage(make_response(usage={
                "prompt_tokens": index, "completion_tokens": 1,
            }), operation=str(index))
    history = BaseAgent.get_token_usage()
    assert len(history) == 10000
    assert history[0]["operation"] == "5"
    assert len(records) == 10005
    assert BaseAgent.summarize_token_usage()["call_count"] == 10000
    assert BaseAgent.summarize_token_usage()["total_tokens"] == sum(range(5, 10005)) + 10000
    assert BaseAgent.summarize_token_records(records)["call_count"] == 10005


class FakeCompletions:
    def __init__(self, responses):
        self._responses = iter(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        response = next(self._responses)
        if isinstance(response, Exception):
            raise response
        return response


def make_response(content="ok", usage=None):
    return SimpleNamespace(
        usage=usage,
        choices=[SimpleNamespace(message=SimpleNamespace(content=content))],
    )


def install_responses(agent, responses):
    completions = FakeCompletions(responses)
    agent.client = SimpleNamespace(
        chat=SimpleNamespace(completions=completions)
    )
    return completions


def test_llm_exception_classification_distinguishes_transport_failures():
    class APIConnectionError(Exception):
        pass

    class APITimeoutError(Exception):
        pass

    assert classify_llm_exception(APIConnectionError("offline"))[:2] == (
        "model_connection_failed",
        502,
    )
    assert classify_llm_exception(APITimeoutError("slow"))[:2] == (
        "model_timeout",
        504,
    )


def test_llm_call_failure_keeps_legacy_string_shape_and_safe_diagnostics():
    failure = LLMCallFailure(
        "LLM调用失败: offline",
        error_code="model_connection_failed",
        exception_type="APIConnectionError",
        status_code=None,
    )

    assert failure.startswith("LLM调用失败:")
    assert failure.error_code == "model_connection_failed"
    assert failure.diagnostic() == {"exception_type": "APIConnectionError"}


@pytest.fixture(autouse=True)
def reset_token_usage():
    # 全局账本需要在测试间隔离，避免执行顺序影响断言。
    BaseAgent.reset_token_usage()
    yield
    BaseAgent.reset_token_usage()


def test_call_llm_records_zhipu_usage_and_summarizes_by_agent_and_model():
    agent = DummyAgent("structure-generator")
    agent.model = "glm-test"
    install_responses(
        agent,
        [
            make_response(
                usage=SimpleNamespace(
                    prompt_tokens=120,
                    completion_tokens=30,
                    total_tokens=150,
                )
            )
        ],
    )

    assert agent.call_llm([{"role": "user", "content": "hello"}]) == "ok"

    assert BaseAgent.get_token_usage() == [
        {
            "agent": "structure-generator",
            "model": "glm-test",
            "prompt_tokens": 120,
            "completion_tokens": 30,
            "total_tokens": 150,
            "usage_reported": True,
        }
    ]
    assert BaseAgent.summarize_token_usage() == {
        "call_count": 1,
        "prompt_tokens": 120,
        "completion_tokens": 30,
        "total_tokens": 150,
        "unreported_usage_call_count": 0,
        "by_agent": {
            "structure-generator": {
                "call_count": 1,
                "prompt_tokens": 120,
                "completion_tokens": 30,
                "total_tokens": 150,
            }
        },
        "by_model": {
            "glm-test": {
                "call_count": 1,
                "prompt_tokens": 120,
                "completion_tokens": 30,
                "total_tokens": 150,
            }
        },
    }


def test_dict_usage_without_total_derives_total_from_prompt_and_completion():
    agent = DummyAgent("branch-generator")
    install_responses(
        agent,
        [make_response(usage={"prompt_tokens": "8", "completion_tokens": 5})],
    )

    agent.call_llm([])

    record = BaseAgent.get_token_usage()[0]
    assert record["prompt_tokens"] == 8
    assert record["completion_tokens"] == 5
    assert record["total_tokens"] == 13


def test_call_llm_forwards_opt_in_json_and_thinking_controls():
    agent = DummyAgent("structured-generator")
    completions = install_responses(agent, [make_response(usage={})])

    agent.call_llm(
        [],
        response_format={"type": "json_object"},
        thinking={"type": "disabled"},
    )

    assert completions.calls[0]["response_format"] == {"type": "json_object"}
    assert completions.calls[0]["thinking"] == {"type": "disabled"}


def test_scoped_capture_records_operation_without_resetting_global_ledger():
    agent = DummyAgent("stage-generator")
    install_responses(
        agent,
        [make_response(usage={"prompt_tokens": 7, "completion_tokens": 4})],
    )

    with BaseAgent.capture_token_usage() as records:
        agent.call_llm([], operation="initial_generation")

    assert len(records) == 1
    assert records[0]["operation"] == "initial_generation"
    assert BaseAgent.summarize_token_records(records)["total_tokens"] == 11
    assert BaseAgent.summarize_token_usage()["total_tokens"] == 11


def test_scoped_capture_is_isolated_between_concurrent_generation_requests():
    def capture_one(index):
        agent = DummyAgent(f"stage-{index}")
        with BaseAgent.capture_token_usage() as records:
            agent._record_token_usage(
                make_response(
                    usage={
                        "prompt_tokens": index + 1,
                        "completion_tokens": 2,
                        "total_tokens": index + 3,
                    }
                ),
                operation="contract_repair" if index else "initial_generation",
            )
        return records

    with ThreadPoolExecutor(max_workers=2) as executor:
        first, second = list(executor.map(capture_one, range(2)))

    assert [record["agent"] for record in first] == ["stage-0"]
    assert [record["agent"] for record in second] == ["stage-1"]
    assert BaseAgent.summarize_token_records(first)["call_count"] == 1
    assert BaseAgent.summarize_token_records(second)["call_count"] == 1
    assert BaseAgent.summarize_token_usage()["call_count"] == 2


def test_missing_or_invalid_usage_is_recorded_without_breaking_generation():
    agent = DummyAgent("concept-generator")
    install_responses(agent, [make_response(content="generated", usage=None)])

    assert agent.call_llm([]) == "generated"

    assert BaseAgent.get_token_usage()[0] == {
        "agent": "concept-generator",
        "model": agent.model,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
        "usage_reported": False,
    }
    assert BaseAgent.summarize_token_usage()["unreported_usage_call_count"] == 1


def test_failed_attempt_marks_measurement_incomplete_before_successful_retry():
    agent = DummyAgent("retrying-agent")
    install_responses(
        agent,
        [
            RuntimeError("temporary error"),
            make_response(usage={"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 5}),
        ],
    )

    assert agent.call_llm([], max_retries=2) == "ok"
    summary = BaseAgent.summarize_token_usage()
    assert summary["call_count"] == 2
    assert summary["total_tokens"] == 5
    assert summary["unreported_usage_call_count"] == 1


def test_malformed_response_body_does_not_double_count_reported_call():
    """服务端已返回 usage 时，坏 choices 不能再被记成第二次未知调用。"""
    agent = DummyAgent("malformed-response-agent")
    install_responses(
        agent,
        [
            SimpleNamespace(
                usage={"prompt_tokens": 3, "completion_tokens": 1, "total_tokens": 4},
                choices=[],
            )
        ],
    )

    assert agent.call_llm([], max_retries=1).startswith("LLM调用失败:")
    summary = BaseAgent.summarize_token_usage()
    assert summary["call_count"] == 1
    assert summary["total_tokens"] == 4
    assert summary["unreported_usage_call_count"] == 0


def test_usage_snapshots_are_detached_and_concurrent_recording_is_lossless():
    def record_one(index):
        agent = DummyAgent(f"agent-{index % 2}")
        agent.model = "glm-concurrent"
        agent._record_token_usage(
            make_response(
                usage={"prompt_tokens": 1, "completion_tokens": 2, "total_tokens": 3}
            )
        )

    with ThreadPoolExecutor(max_workers=8) as executor:
        list(executor.map(record_one, range(100)))

    snapshot = BaseAgent.get_token_usage()
    snapshot[0]["total_tokens"] = 999999
    summary = BaseAgent.summarize_token_usage()

    assert summary["call_count"] == 100
    assert summary["prompt_tokens"] == 100
    assert summary["completion_tokens"] == 200
    assert summary["total_tokens"] == 300
    assert summary["by_agent"]["agent-0"]["call_count"] == 50
    assert summary["by_agent"]["agent-1"]["call_count"] == 50
