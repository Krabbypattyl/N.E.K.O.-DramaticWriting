from __future__ import annotations

import stat
import pytest

import config

from theater_generator.api import create_app


def test_model_settings_api_updates_runtime_config_without_returning_key(
    monkeypatch,
    tmp_path,
):
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.delenv("ZHIPU_API_KEY", raising=False)
    settings_path = tmp_path / "model_settings.json"
    monkeypatch.delenv("INKAI_MODEL_SETTINGS_PATH", raising=False)
    monkeypatch.setenv("NEKO_NUMERIC_DRAMA_MODEL_SETTINGS_PATH", str(settings_path))
    config.reset_runtime_model_config()
    try:
        app = create_app()
        client = app.test_client()

        before = client.get("/api/settings/model")
        assert before.status_code == 200
        assert before.get_json()["data"]["has_api_key"] is False

        response = client.put(
            "/api/settings/model",
            json={
                "provider": "qwen",
                "api_key": "local-test-key",
                "model": "qwen-test-model",
                "base_url": "https://qwen.example/v1",
            },
        )
        assert response.status_code == 200
        payload = response.get_json()["data"]
        assert payload["provider"] == "qwen"
        assert payload["model"] == "qwen-test-model"
        assert payload["has_api_key"] is True
        assert "api_key" not in payload

        # 模拟服务重启：清空进程内覆盖后，仍应从本机持久配置恢复。
        config.reset_runtime_model_config()
        restarted = create_app().test_client().get("/api/settings/model")
        restarted_payload = restarted.get_json()["data"]
        assert restarted_payload["provider"] == "qwen"
        assert restarted_payload["model"] == "qwen-test-model"
        assert restarted_payload["base_url"] == "https://qwen.example/v1"
        assert restarted_payload["has_api_key"] is True
        assert "api_key" not in restarted_payload
        assert settings_path.is_file()
        assert stat.S_IMODE(settings_path.stat().st_mode) == 0o600
    finally:
        config.reset_runtime_model_config()


def test_legacy_model_settings_path_remains_a_compatibility_alias(monkeypatch, tmp_path):
    legacy_path = tmp_path / "legacy-model-settings.json"
    monkeypatch.delenv("NEKO_NUMERIC_DRAMA_MODEL_SETTINGS_PATH", raising=False)
    monkeypatch.setenv("INKAI_MODEL_SETTINGS_PATH", str(legacy_path))

    assert config._model_settings_path() == legacy_path


@pytest.mark.parametrize("failure_point", ["replace", "chmod"])
def test_model_settings_failed_write_preserves_memory_and_file(monkeypatch, tmp_path, failure_point):
    path = tmp_path / "settings.json"
    monkeypatch.setenv("NEKO_NUMERIC_DRAMA_MODEL_SETTINGS_PATH", str(path))
    config.reset_runtime_model_config()
    try:
        config.configure_model("qwen", api_key="old-test-key", model="old-model")
        previous_bytes = path.read_bytes()
        previous_config = config.get_model_config()
        def fail(*args, **kwargs):
            raise OSError("isolated write failure")
        monkeypatch.setattr(config.os, failure_point, fail)
        if failure_point == "chmod" and hasattr(config.os, "fchmod"):
            monkeypatch.setattr(config.os, "fchmod", fail)
        with pytest.raises(OSError):
            config.configure_model("zhipu", api_key="new-test-key", model="new-model")
        assert path.read_bytes() == previous_bytes
        assert config.get_model_config() == previous_config
    finally:
        config.reset_runtime_model_config()


def test_model_settings_api_returns_stable_save_failure(monkeypatch, tmp_path):
    monkeypatch.setenv("NEKO_NUMERIC_DRAMA_MODEL_SETTINGS_PATH", str(tmp_path / "settings.json"))
    config.reset_runtime_model_config()
    try:
        config.configure_model("qwen", api_key="old-test-key", model="old-model")
        app = create_app(project_root=tmp_path / "projects")
        app.config.update(TESTING=True)
        def fail(payload):
            raise OSError("do not expose private path or key")
        monkeypatch.setattr(config, "_write_persisted_model_config", fail)
        response = app.test_client().put("/api/settings/model", json={
            "provider": "qwen", "api_key": "new-test-key", "model": "new-model",
        })
        assert response.status_code == 500
        assert response.get_json()["error"]["code"] == "model_settings_save_failed"
        assert "private" not in response.get_data(as_text=True)
        assert config.get_model_config()["model"] == "old-model"
    finally:
        config.reset_runtime_model_config()
