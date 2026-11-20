"""N.E.K.O.-DramaticWriting 到当前 N.E.K.O Numeric v2 编译边界的窄桥接层。"""

from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from typing import Any, Mapping


class NekoV2BridgeError(RuntimeError):
    """N.E.K.O 编译器不可用或返回稳定合同错误。"""

    def __init__(self, code: str, details: dict[str, Any] | None = None):
        super().__init__(code)
        self.code = code
        self.details = dict(details or {})


@dataclass(frozen=True)
class NekoV2Warning:
    code: str
    path: str
    message: str


@dataclass(frozen=True)
class NekoV2CompiledPackage:
    story: dict[str, Any]
    json_bytes: bytes
    package_hash: str
    warnings: tuple[NekoV2Warning, ...]

    @property
    def story_id(self) -> str:
        return str(self.story["meta"]["story_id"])


class NekoV2Bridge:
    """复用 N.E.K.O 的唯一合同实现，并通过独立进程完成最终复验。"""

    def __init__(self, neko_root: Path | None = None):
        configured = (
            os.environ.get("NEKO_NUMERIC_DRAMA_NEKO_ROOT", "").strip()
            or os.environ.get("INKAI_NEKO_ROOT", "").strip()
        )
        self.neko_root = Path(
            neko_root
            or configured
            or (Path(__file__).resolve().parents[2] / "N.E.K.O")
        ).resolve()
        self.validator_path = self.neko_root / "scripts" / "validate_numeric_v2_story.py"
        venv_python = self.neko_root / ".venv" / "bin" / "python"
        self.python = venv_python if venv_python.is_file() else Path(sys.executable)
    def compile(self, story: Mapping[str, Any]) -> Any:
        """工作台检查直接调用同一合同，保证作者看到的路径与 N.E.K.O 一致。"""

        # 两个仓库都有 config/utils 顶级模块，进程内动态导入会被模块缓存串包；
        # 因此编译也交给 N.E.K.O 自己的解释器，三条发布路径共用同一版本门禁。
        data = self._run_cli(story, install=False)
        canonical_story = deepcopy(dict(story))
        json_bytes = json.dumps(
            canonical_story,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return NekoV2CompiledPackage(
            story=canonical_story,
            json_bytes=json_bytes,
            package_hash=str(data["package_hash"]),
            warnings=tuple(
                NekoV2Warning(
                    code=str(item.get("code") or ""),
                    path=str(item.get("path") or ""),
                    message=str(item.get("message") or ""),
                )
                for item in data.get("warnings") or []
                if isinstance(item, Mapping)
            ),
        )

    def validate(self, story: Mapping[str, Any]) -> dict[str, Any]:
        """使用 N.E.K.O 自己的 Python 环境重新读取并编译 canonical bytes。"""

        return self._run_cli(story, install=False)

    def install(self, story: Mapping[str, Any]) -> dict[str, Any]:
        """由 N.E.K.O CLI 解析真实存储策略并原子写入专属包目录。"""

        return self._run_cli(story, install=True)

    def authoring_names(self) -> dict[str, str]:
        """只读取本体当前猫娘名和用户昵称；SDK 迁入后改用宿主直接注入。"""

        return self._run_cli(None, install=False)

    def _run_cli(self, story: Mapping[str, Any] | None, *, install: bool) -> dict[str, Any]:
        if not self.validator_path.is_file():
            raise NekoV2BridgeError("neko_v2_validator_unavailable")
        temporary_path: Path | None = None
        try:
            if story is None:
                command = [str(self.python), str(self.validator_path), "--authoring-names"]
            else:
                with tempfile.NamedTemporaryFile(
                    prefix="neko-numeric-drama-v2-",
                    suffix=".json",
                    delete=False,
                ) as temporary:
                    temporary.write(json.dumps(
                        story,
                        ensure_ascii=False,
                        sort_keys=True,
                        separators=(",", ":"),
                    ).encode("utf-8"))
                    temporary_path = Path(temporary.name)
                command = [str(self.python), str(self.validator_path), str(temporary_path)]
            if install:
                command.append("--install")
            result = subprocess.run(
                command,
                cwd=self.neko_root,
                capture_output=True,
                text=True,
                timeout=30,
                check=False,
            )
            # N.E.K.O 的存储配置初始化可能输出诊断日志；稳定 JSON 永远位于最后一行。
            lines = [line for line in (result.stdout or "").splitlines() if line.strip()]
            output = json.loads(lines[-1] if lines else "{}")
        except subprocess.TimeoutExpired as exc:
            raise NekoV2BridgeError("neko_v2_validator_timeout") from exc
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise NekoV2BridgeError("neko_v2_validator_unavailable") from exc
        finally:
            if temporary_path is not None and temporary_path.exists():
                temporary_path.unlink()
        if not output.get("success"):
            error = output.get("error") if isinstance(output.get("error"), dict) else {}
            raise NekoV2BridgeError(
                str(error.get("code") or "neko_v2_validation_failed"),
                error.get("details") if isinstance(error.get("details"), dict) else None,
            )
        return dict(output.get("data") or {})


__all__ = ["NekoV2Bridge", "NekoV2BridgeError"]
