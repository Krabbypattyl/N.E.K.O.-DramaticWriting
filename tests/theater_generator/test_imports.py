from __future__ import annotations

import subprocess
import sys


def test_numeric_api_imports_in_fresh_interpreter():
    """确保精简后的包入口不依赖已经移除的作者项目模块。"""

    result = subprocess.run(
        [sys.executable, "-c", "import theater_generator.api"],
        check=False,
        capture_output=True,
        text=True,
    )

    assert result.returncode == 0, result.stderr
