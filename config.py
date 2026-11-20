"""N.E.K.O 小剧场剧本生成器模型配置。

模型密钥优先从用户级本机配置或环境变量读取，禁止写入仓库文件。
"""  # noqa: DOCSTRING_CJK

from __future__ import annotations

import json
import os
from pathlib import Path
import sys
from threading import RLock


# ``qwen`` 是当前真实生成默认 provider；保留 ``zhipu`` 作为显式回退。
# 旧 ``INKAI_*`` 变量只作为改名前环境的兼容入口，新名称始终优先。
def _project_env(name: str, legacy_name: str, default: str = "") -> str:
    current = os.getenv(name)
    if current is not None:
        return current
    return os.getenv(legacy_name, default)


API_PROVIDER = _project_env(
    "NEKO_NUMERIC_DRAMA_LLM_PROVIDER",
    "INKAI_LLM_PROVIDER",
    "qwen",
).strip().lower()
if API_PROVIDER not in {"qwen", "zhipu"}:
    raise ValueError("NEKO_NUMERIC_DRAMA_LLM_PROVIDER 只能是 qwen 或 zhipu")

API_KEY = os.getenv(
    "DASHSCOPE_API_KEY" if API_PROVIDER == "qwen" else "ZHIPU_API_KEY",
    "",
).strip()
MODEL_NAME = _project_env(
    "NEKO_NUMERIC_DRAMA_MODEL_NAME",
    "INKAI_MODEL_NAME",
    "qwen-plus" if API_PROVIDER == "qwen" else "glm-4.5-flash",
).strip()
BASE_URL = os.getenv(
    "DASHSCOPE_BASE_URL",
    "https://dashscope.aliyuncs.com/compatible-mode/v1",
).rstrip("/")
TEMPERATURE = float(_project_env("NEKO_NUMERIC_DRAMA_TEMPERATURE", "INKAI_TEMPERATURE", "0.6"))
REQUEST_TIMEOUT_SECONDS = float(_project_env("NEKO_NUMERIC_DRAMA_LLM_TIMEOUT", "INKAI_LLM_TIMEOUT", "120"))


PROVIDER_DEFAULTS = {
    "qwen": {
        "label": "千问",
        "key_env": "DASHSCOPE_API_KEY",
        "model": "qwen-plus",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "base_url_env": "DASHSCOPE_BASE_URL",
    },
    "zhipu": {
        "label": "智谱",
        "key_env": "ZHIPU_API_KEY",
        "model": "glm-4.5-flash",
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "base_url_env": "ZHIPU_BASE_URL",
    },
}

_runtime_config_lock = RLock()
_runtime_config: dict[str, dict[str, str]] = {}
_runtime_provider: str | None = None


def _model_settings_path() -> Path:
    """返回仓库外的用户级配置路径；测试可用环境变量隔离。"""

    explicit = _project_env(
        "NEKO_NUMERIC_DRAMA_MODEL_SETTINGS_PATH",
        "INKAI_MODEL_SETTINGS_PATH",
    ).strip()
    if explicit:
        return Path(explicit).expanduser()
    return _model_settings_root() / "NEKO_Numeric_drama" / "model_settings.json"


def _model_settings_root() -> Path:
    """返回当前平台的用户级配置根目录。"""

    if sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support"
    elif os.name == "nt":
        return Path(os.getenv("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
    return Path(os.getenv("XDG_CONFIG_HOME", str(Path.home() / ".config")))


def _model_settings_read_path() -> Path:
    """优先读取新路径；仅在未显式配置且新文件不存在时兼容旧路径。"""

    current = _model_settings_path()
    if current.is_file() or _project_env(
        "NEKO_NUMERIC_DRAMA_MODEL_SETTINGS_PATH",
        "INKAI_MODEL_SETTINGS_PATH",
    ).strip():
        return current
    legacy = _model_settings_root() / "InkAI" / "model_settings.json"
    return legacy if legacy.is_file() else current


def _read_persisted_model_config() -> dict[str, object]:
    """读取本机设置；损坏文件不应阻断服务启动。"""

    path = _model_settings_read_path()
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError):
        return {"active_provider": None, "providers": {}}
    if not isinstance(payload, dict):
        return {"active_provider": None, "providers": {}}
    active_provider = payload.get("active_provider")
    if active_provider not in PROVIDER_DEFAULTS:
        active_provider = None
    providers: dict[str, dict[str, str]] = {}
    raw_providers = payload.get("providers")
    if isinstance(raw_providers, dict):
        for provider, raw in raw_providers.items():
            if provider not in PROVIDER_DEFAULTS or not isinstance(raw, dict):
                continue
            providers[provider] = {
                field: str(raw.get(field) or "").strip().rstrip("/") if field == "base_url" else str(raw.get(field) or "").strip()
                for field in ("api_key", "model", "base_url")
            }
    return {"active_provider": active_provider, "providers": providers}


def _write_persisted_model_config(payload: dict[str, object]) -> None:
    """原子写入本机设置，并把包含密钥的文件权限限制为当前用户。"""

    path = _model_settings_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = path.with_name(f".{path.name}.tmp")
    descriptor = os.open(temporary_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
            if hasattr(os, "fchmod"):
                os.fchmod(handle.fileno(), 0o600)
            else:
                os.chmod(temporary_path, 0o600)
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
        os.replace(temporary_path, path)
    except Exception:
        try:
            temporary_path.unlink()
        except OSError:
            pass
        raise


def _environment_model_config(provider: str) -> dict[str, str]:
    defaults = PROVIDER_DEFAULTS[provider]
    return {
        "provider": provider,
        "api_key": os.getenv(defaults["key_env"], "").strip(),
        "model": _project_env(
            "NEKO_NUMERIC_DRAMA_MODEL_NAME",
            "INKAI_MODEL_NAME",
            defaults["model"],
        ).strip(),
        "base_url": os.getenv(
            defaults["base_url_env"],
            defaults["base_url"],
        ).strip().rstrip("/"),
    }


def get_model_config() -> dict[str, str | float]:
    """返回当前配置，进程覆盖优先于本机持久设置和环境变量。"""

    with _runtime_config_lock:
        persisted = _read_persisted_model_config()
        provider = _runtime_provider or persisted["active_provider"] or API_PROVIDER
        settings = _environment_model_config(provider)
        settings.update(dict(persisted["providers"]).get(provider, {}))
        settings.update(_runtime_config.get(provider, {}))
    return {
        **settings,
        "temperature": TEMPERATURE,
        "timeout_seconds": REQUEST_TIMEOUT_SECONDS,
    }


def configure_model(
    provider: str,
    *,
    api_key: str = "",
    model: str = "",
    base_url: str = "",
) -> dict[str, str | float]:
    """保存 UI 选择的模型配置，并立即更新当前服务进程。"""

    if provider not in PROVIDER_DEFAULTS:
        raise ValueError("unsupported_model_provider")
    environment = _environment_model_config(provider)
    with _runtime_config_lock:
        persisted = _read_persisted_model_config()
        persisted_providers = dict(persisted["providers"])
        persisted_provider = dict(persisted_providers.get(provider, {}))
        existing = _runtime_config.get(provider, {})
        resolved_api_key = (
            api_key.strip()
            or existing.get("api_key")
            or persisted_provider.get("api_key")
            or environment["api_key"]
        )
        if not resolved_api_key:
            raise ValueError("model_api_key_required")
        resolved_model = model.strip() or existing.get("model") or persisted_provider.get("model") or environment["model"]
        resolved_base_url = (
            base_url.strip().rstrip("/")
            or existing.get("base_url")
            or persisted_provider.get("base_url")
            or environment["base_url"]
        )
        global _runtime_provider
        next_config = {
            "api_key": resolved_api_key,
            "model": resolved_model,
            "base_url": resolved_base_url,
        }
        persisted_providers[provider] = dict(next_config)
        _write_persisted_model_config({
            "active_provider": provider,
            "providers": persisted_providers,
        })
        _runtime_config[provider] = next_config
        _runtime_provider = provider
    return get_model_config()


def public_model_config() -> dict[str, object]:
    """Expose editable settings without returning the API key."""

    settings = get_model_config()
    return {
        "provider": settings["provider"],
        "model": settings["model"],
        "base_url": settings["base_url"],
        "has_api_key": bool(settings["api_key"]),
        "providers": [
            {
                "id": provider,
                "label": values["label"],
                "default_model": values["model"],
                "default_base_url": values["base_url"],
            }
            for provider, values in PROVIDER_DEFAULTS.items()
        ],
    }


def reset_runtime_model_config() -> None:
    """Clear UI overrides; intended for isolated tests and local recovery."""

    global _runtime_provider
    with _runtime_config_lock:
        _runtime_config.clear()
        _runtime_provider = None
