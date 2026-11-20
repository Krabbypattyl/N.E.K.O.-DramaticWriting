"""
基础智能体类，提供通用的LLM调用功能
"""
from abc import ABC, abstractmethod
from collections import deque
from contextlib import contextmanager
from contextvars import ContextVar
from types import SimpleNamespace
from typing import Dict, List, Any, Iterator, Optional
import httpx
from zhipuai import ZhipuAI
import json
import threading
import config


class LLMCallFailure(str):
    """String-compatible failure carrying a safe upstream error category."""

    def __new__(
        cls,
        message: str,
        *,
        error_code: str,
        exception_type: str,
        status_code: int | None = None,
        provider_code: str = "",
    ):
        value = super().__new__(cls, message)
        value.error_code = error_code
        value.exception_type = exception_type
        value.status_code = status_code
        value.provider_code = provider_code
        return value

    def diagnostic(self) -> Dict[str, Any]:
        """Return only non-sensitive fields safe for an API error envelope."""
        result: Dict[str, Any] = {
            "exception_type": self.exception_type,
        }
        if self.status_code is not None:
            result["upstream_status_code"] = self.status_code
        if self.provider_code:
            result["provider_code"] = self.provider_code
        return result


class QwenAPIError(RuntimeError):
    """保留千问兼容接口的 HTTP 状态，供统一错误分类使用。"""

    def __init__(self, message: str, *, status_code: int | None = None, code: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class _QwenCompletions:
    """最小 OpenAI-compatible Chat Completions 适配器。"""

    def __init__(self, *, api_key: str, base_url: str, timeout: float):
        self._api_key = api_key.strip()
        self._headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
        }
        self._endpoint = f"{base_url.rstrip('/')}/chat/completions"
        self._client = httpx.Client(timeout=timeout)

    def create(self, **request: Any) -> Any:
        if not self._api_key:
            raise QwenAPIError(
                "DASHSCOPE_API_KEY is not configured",
                status_code=401,
                code="missing_api_key",
            )
        # 千问兼容接口使用 enable_thinking，不接受智谱的 thinking 对象。
        thinking = request.pop("thinking", None)
        if isinstance(thinking, dict) and thinking.get("type") in {"enabled", "disabled"}:
            request["enable_thinking"] = thinking["type"] == "enabled"
        try:
            response = self._client.post(
                self._endpoint,
                headers=self._headers,
                json=request,
            )
        except httpx.TimeoutException as exc:
            raise QwenAPIError("Qwen request timed out") from exc
        except httpx.HTTPError as exc:
            raise QwenAPIError("Qwen connection failed") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise QwenAPIError(
                "Qwen returned a non-JSON response",
                status_code=response.status_code,
            ) from exc
        if response.status_code >= 400:
            error = payload.get("error") if isinstance(payload, dict) else {}
            if not isinstance(error, dict):
                error = {}
            raise QwenAPIError(
                str(error.get("message") or "Qwen request failed"),
                status_code=response.status_code,
                code=str(error.get("code") or ""),
            )
        choices = payload.get("choices") if isinstance(payload, dict) else []
        if not isinstance(choices, list) or not choices:
            raise QwenAPIError("Qwen response contains no choices", status_code=response.status_code)
        normalized_choices = []
        for choice in choices:
            message = choice.get("message") if isinstance(choice, dict) else {}
            normalized_choices.append(
                SimpleNamespace(
                    message=SimpleNamespace(content=(message or {}).get("content", "")),
                    finish_reason=choice.get("finish_reason") if isinstance(choice, dict) else None,
                )
            )
        return SimpleNamespace(
            usage=payload.get("usage") if isinstance(payload, dict) else None,
            choices=normalized_choices,
        )


class _QwenClient:
    """Expose the same ``client.chat.completions.create`` shape as ZhipuAI."""

    def __init__(self, *, api_key: str, base_url: str, timeout: float):
        self.chat = SimpleNamespace(
            completions=_QwenCompletions(
                api_key=api_key,
                base_url=base_url,
                timeout=timeout,
            )
        )


def classify_llm_exception(error: Exception) -> tuple[str, int, str]:
    """Map provider exceptions to stable API categories without leaking details."""
    exception_type = type(error).__name__
    status_code = getattr(error, "status_code", None)
    provider_code = str(getattr(error, "code", None) or "")
    if exception_type == "QwenAPIError":
        message = str(error).lower()
        if "timed out" in message:
            return "model_timeout", 504, provider_code
        if "connection failed" in message:
            return "model_connection_failed", 502, provider_code
    if exception_type in {
        "APITimeoutError",
        "ReadTimeout",
        "ConnectTimeout",
        "TimeoutError",
        "TimeoutException",
    }:
        return "model_timeout", 504, provider_code
    if exception_type in {"APIConnectionError", "ConnectionError", "ConnectError", "HTTPError"}:
        return "model_connection_failed", 502, provider_code
    if exception_type in {"AuthenticationError", "PermissionDeniedError"} or status_code in {401, 403}:
        return "model_auth_failed", 502, provider_code
    if exception_type == "RateLimitError" or status_code == 429:
        return "model_rate_limited", 429, provider_code
    if status_code is not None and 400 <= int(status_code) < 500:
        return "model_request_invalid", 422, provider_code
    return "model_provider_error", 502, provider_code


class BaseAgent(ABC):
    """基础智能体抽象类"""

    _REQUEST_TIMEOUT_SECONDS = config.REQUEST_TIMEOUT_SECONDS

    # 兼容诊断脚本的进程账本只保留最近 10000 次尝试；完整操作用 capture。
    _token_usage_lock = threading.Lock()
    _token_usage_records: deque[Dict[str, Any]] = deque(maxlen=10000)
    # 全局账本服务于命令行全流程统计；ContextVar 额外隔离单个 Web 请求，
    # 避免并发生成时为了计量而清空或混入其他项目的 token 记录。
    _token_usage_capture: ContextVar[Optional[List[Dict[str, Any]]]] = ContextVar(
        "token_usage_capture",
        default=None,
    )
    
    def __init__(self, name: str):
        self.name = name
        self._model_config_signature = None
        self._refresh_model_config()

    def _refresh_model_config(self) -> None:
        """Apply environment or homepage-selected settings before a model call."""

        settings = config.get_model_config()
        signature = (
            settings["provider"],
            settings["api_key"],
            settings["model"],
            settings["base_url"],
            settings["timeout_seconds"],
        )
        if signature == self._model_config_signature:
            return
        # 只保留 call_llm 中可观测的业务重试，避免 SDK 的隐式重试与它
        # 相乘，使单个阶段在网络异常时悬挂数十分钟。
        if settings["provider"] == "qwen":
            self.client = _QwenClient(
                api_key=str(settings["api_key"]),
                base_url=str(settings["base_url"]),
                timeout=float(settings["timeout_seconds"]),
            )
        else:
            self.client = ZhipuAI(
                api_key=str(settings["api_key"]),
                base_url=str(settings["base_url"]),
                timeout=float(settings["timeout_seconds"]),
                max_retries=0,
            )
        self.model = str(settings["model"])
        self.temperature = float(settings["temperature"])
        self._model_config_signature = signature
    
    def call_llm(
        self,
        messages: List[Dict[str, str]],
        temperature: Optional[float] = None,
        max_tokens: Optional[int] = None,
        max_retries: int = 3,
        response_format: Optional[Dict[str, str]] = None,
        thinking: Optional[Dict[str, str]] = None,
        operation: Optional[str] = None,
    ) -> str:
        """调用大语言模型"""
        self._refresh_model_config()
        for attempt in range(max_retries):
            response_received = False
            try:
                # 设置默认的最大token数（GLM-4.5-flash的最大输出token）
                if max_tokens is None:
                    max_tokens = 8192  # GLM-4.5-flash的最大输出token数
                
                request: Dict[str, Any] = {
                    "model": self.model,
                    "messages": messages,
                    "temperature": temperature or self.temperature,
                    "max_tokens": max_tokens,
                }
                # 只有明确需要结构化输出或思考控制的当前生成阶段才传入这些参数，
                # 其余阶段继续使用同一条最小模型调用合同。
                if response_format is not None:
                    request["response_format"] = response_format
                if thinking is not None:
                    request["thinking"] = thinking
                response = self.client.chat.completions.create(
                    **request
                )
                response_received = True
                # create 已成功返回就意味着本次请求可能已经产生费用；先记账再读取
                # choices，可避免响应正文结构异常触发重试时漏记已经消耗的 token。
                self._record_token_usage(response, operation=operation)
                return response.choices[0].message.content
            except Exception as e:
                if not response_received:
                    # 只有服务端没有返回 response 时才缺少 usage；若 response 已返回但
                    # 正文结构损坏，上方已记过该次调用，不能再追加一个虚假的未知调用。
                    self._record_unreported_attempt(operation=operation)
                error_msg = f"LLM调用失败 (尝试 {attempt + 1}/{max_retries}): {e}"
                self.log(error_msg)
                
                if attempt == max_retries - 1:
                    # 最后一次尝试失败：保持字符串兼容，同时携带稳定错误分类，
                    # 由 API 层映射为连接/超时/上游错误，而不是笼统 HTTP 400。
                    error_code, _http_status, provider_code = classify_llm_exception(e)
                    return LLMCallFailure(
                        f"LLM调用失败: {str(e)}",
                        error_code=error_code,
                        exception_type=type(e).__name__,
                        status_code=getattr(e, "status_code", None),
                        provider_code=provider_code,
                    )
                
                # 等待一段时间后重试
                import time
                time.sleep(2 ** attempt)  # 指数退避
        
        return "LLM调用失败: 超过最大重试次数"

    @staticmethod
    def _usage_value(usage: Any, field: str) -> Any:
        """兼容 Zhipu SDK usage 对象和测试/代理层返回的字典。"""
        if isinstance(usage, dict):
            return usage.get(field)
        return getattr(usage, field, None)

    @staticmethod
    def _safe_token_count(value: Any) -> int:
        """把缺失或异常的 usage 字段安全归零，避免计量影响正常生成。"""
        if value is None or isinstance(value, bool):
            return 0
        try:
            count = int(value)
        except (TypeError, ValueError, OverflowError):
            return 0
        return max(count, 0)

    def _record_token_usage(
        self,
        response: Any,
        operation: Optional[str] = None,
    ) -> None:
        """记录一次已成功返回的模型请求。"""
        usage = getattr(response, "usage", None)
        if usage is None and isinstance(response, dict):
            usage = response.get("usage")

        prompt_tokens = self._safe_token_count(
            self._usage_value(usage, "prompt_tokens") if usage is not None else None
        )
        completion_tokens = self._safe_token_count(
            self._usage_value(usage, "completion_tokens") if usage is not None else None
        )
        raw_total = (
            self._usage_value(usage, "total_tokens") if usage is not None else None
        )
        # 某些兼容接口只返回输入和输出 token；此时按两者之和补出总量，
        # 让全流程汇总仍可使用，同时保留 usage_reported 供调用方识别缺报。
        total_tokens = (
            prompt_tokens + completion_tokens
            if raw_total is None
            else self._safe_token_count(raw_total)
        )
        record = {
            "agent": self.name,
            "model": self.model,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "total_tokens": total_tokens,
            "usage_reported": usage is not None,
        }
        if operation:
            record["operation"] = operation
        self._append_token_record(record)

    @classmethod
    def _append_token_record(cls, record: Dict[str, Any]) -> None:
        """Append to the process ledger and the active request capture."""
        # Web 服务可能并发生成多个阶段；锁保证全局账本追加、读取和清空
        # 看到一致快照。请求级 capture 由 ContextVar 隔离，无需共享锁。
        with BaseAgent._token_usage_lock:
            BaseAgent._token_usage_records.append(record.copy())
        capture = BaseAgent._token_usage_capture.get()
        if capture is not None:
            capture.append(record.copy())

    def _record_unreported_attempt(self, operation: Optional[str] = None) -> None:
        """Conservatively mark an exception path whose server usage is unknown."""
        record = {
            "agent": self.name,
            "model": self.model,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "usage_reported": False,
        }
        if operation:
            record["operation"] = operation
        self._append_token_record(record)

    @classmethod
    @contextmanager
    def capture_token_usage(cls) -> Iterator[List[Dict[str, Any]]]:
        """Capture only model calls made in the current generation context."""
        records: List[Dict[str, Any]] = []
        token = BaseAgent._token_usage_capture.set(records)
        try:
            yield records
        finally:
            BaseAgent._token_usage_capture.reset(token)

    @classmethod
    def reset_token_usage(cls) -> None:
        """清空进程内 token 账本，通常在一次完整流程开始前调用。"""
        with BaseAgent._token_usage_lock:
            BaseAgent._token_usage_records.clear()

    @classmethod
    def get_token_usage(cls) -> List[Dict[str, Any]]:
        """返回最近最多 10000 次调用的独立快照；更早记录已从进程窗口淘汰。"""
        with BaseAgent._token_usage_lock:
            return [record.copy() for record in BaseAgent._token_usage_records]

    @classmethod
    def summarize_token_usage(cls) -> Dict[str, Any]:
        """汇总最近最多 10000 次调用的窗口；完整操作请汇总 capture 的记录。"""
        return cls.summarize_token_records(cls.get_token_usage())

    @classmethod
    def summarize_token_records(
        cls,
        records: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        """Summarize a detached record set such as one generation request."""
        summary: Dict[str, Any] = {
            "call_count": len(records),
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
            "unreported_usage_call_count": 0,
            "by_agent": {},
            "by_model": {},
        }

        def add_to_group(groups: Dict[str, Dict[str, int]], key: str, record: Dict[str, Any]) -> None:
            group = groups.setdefault(
                key,
                {
                    "call_count": 0,
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                },
            )
            group["call_count"] += 1
            for field in ("prompt_tokens", "completion_tokens", "total_tokens"):
                group[field] += record[field]

        for record in records:
            for field in ("prompt_tokens", "completion_tokens", "total_tokens"):
                summary[field] += record[field]
            if not record["usage_reported"]:
                summary["unreported_usage_call_count"] += 1
            add_to_group(summary["by_agent"], record["agent"], record)
            add_to_group(summary["by_model"], record["model"], record)

        # summary 全部由账本快照构造，调用方可自由序列化或修改，不会反向改写账本。
        return summary
    
    def parse_json_response(self, response: str) -> Dict[str, Any]:
        """解析JSON响应，确保返回结构化数据"""
        try:
            # 尝试直接解析
            return json.loads(response)
        except json.JSONDecodeError:
            pass
        
        # 尝试处理markdown格式的JSON (优先处理)
        try:
            if '```json' in response:
                # 提取markdown代码块中的JSON
                start_marker = '```json'
                end_marker = '```'
                start = response.find(start_marker)
                if start != -1:
                    start += len(start_marker)
                    end = response.find(end_marker, start)
                    if end != -1:
                        json_str = response[start:end].strip()
                        # 修复常见的JSON格式问题
                        json_str = self._fix_json_format(json_str)
                        result = json.loads(json_str)
                        print(f"成功解析markdown JSON")
                        return result
        except json.JSONDecodeError as e:
            print(f"markdown JSON解析失败: {e}")
            pass
        
        # 尝试提取JSON部分（从第一个{到最后一个}）
        try:
            start = response.find('{')
            end = response.rfind('}') + 1
            if start != -1 and end != 0:
                json_str = response[start:end]
                # 修复常见的JSON格式问题
                json_str = self._fix_json_format(json_str)
                return json.loads(json_str)
        except json.JSONDecodeError:
            pass
        
        # 如果无法解析，尝试提取可能的文本内容
        # 如果响应看起来像markdown，尝试提取文本部分
        if '```' in response:
            # 尝试提取markdown中的文本内容
            lines = response.split('\n')
            text_content = []
            in_code_block = False
            for line in lines:
                if line.strip().startswith('```'):
                    in_code_block = not in_code_block
                    continue
                if not in_code_block and line.strip():
                    text_content.append(line)
            
            if text_content:
                return {"content": '\n'.join(text_content)}
        
        # 最后尝试，返回原始文本但添加错误标记
        print(f"警告：无法解析JSON响应，返回原始文本")
        return {"content": response, "parse_error": True}
    
    def _fix_json_format(self, json_str: str) -> str:
        """Repair bounded syntax errors without guessing or rewriting string values."""
        json_str = json_str.strip()
        pieces = []
        index = 0
        while index < len(json_str):
            char = json_str[index]
            if char == '"':
                try:
                    value, end = json.decoder.scanstring(json_str, index + 1, False)
                except json.JSONDecodeError:
                    return json_str
                token = json_str[index:end]
                # Escape actual controls while retaining the decoded text. Valid
                # escapes and punctuation inside strings remain untouched.
                pieces.append(json.dumps(value, ensure_ascii=False)
                              if any(ord(char) < 32 for char in token) else token)
                index = end
                continue
            if char == ',' and json_str[index + 1:].lstrip().startswith(('}', ']')):
                index += 1
                continue
            pieces.append(char)
            index += 1
        candidate = ''.join(pieces)
        for _ in range(3):
            try:
                json.loads(candidate)
                return candidate
            except json.JSONDecodeError as error:
                repaired = self._smart_fix_json_by_error(candidate, error)
                if repaired == candidate:
                    break
                candidate = repaired
        return candidate

    def _smart_fix_json_by_error(self, json_str: str, error: json.JSONDecodeError) -> str:
        """Insert only a missing structural delimiter after a completed JSON token."""
        delimiter = {
            "Expecting ',' delimiter": ',',
            "Expecting ':' delimiter": ':',
        }.get(error.msg)
        if delimiter is None:
            return json_str
        # The decoder emits these errors outside a string. Never infer missing
        # quotes or replace characters inside an ambiguous string token.
        return json_str[:error.pos] + delimiter + json_str[error.pos:]

    @abstractmethod
    def process(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """处理输入数据，返回处理结果"""
        pass
    
    def log(self, message: str):
        """记录日志"""
        print(f"[{self.name}] {message}")
    
    def validate_input(self, input_data: Dict[str, Any], required_fields: List[str]) -> Dict[str, Any]:
        """验证输入数据"""
        missing_fields = []
        for field in required_fields:
            if field not in input_data or not input_data[field]:
                missing_fields.append(field)
        
        if missing_fields:
            return {
                "is_valid": False,
                "error": f"缺少必要字段: {', '.join(missing_fields)}"
            }
        
        return {"is_valid": True}
    
    def handle_error(self, error: Exception, context: str = "") -> Dict[str, Any]:
        """统一错误处理"""
        error_msg = f"{context}: {str(error)}" if context else str(error)
        self.log(f"错误: {error_msg}")
        
        return {
            "error": error_msg,
            "error_type": type(error).__name__,
            "context": context
        }
