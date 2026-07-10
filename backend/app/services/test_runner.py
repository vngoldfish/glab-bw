"""Run project pytest suite and return structured results."""

from __future__ import annotations

import os
import re
import subprocess
import sys
import time
from pathlib import Path

from app.core.config import PROJECT_ROOT

# Match pytest summary lines like: "6 passed in 0.22s" / "1 failed, 5 passed"
_SUMMARY_RE = re.compile(
    r"(?P<failed>\d+) failed|"
    r"(?P<passed>\d+) passed|"
    r"(?P<skipped>\d+) skipped|"
    r"(?P<errors>\d+) error|"
    r"(?P<xfailed>\d+) xfailed",
    re.I,
)


def _python_bin() -> str:
    venv = PROJECT_ROOT / "backend" / ".venv" / "bin" / "python"
    if venv.is_file():
        return str(venv)
    venv_win = PROJECT_ROOT / "backend" / ".venv" / "Scripts" / "python.exe"
    if venv_win.is_file():
        return str(venv_win)
    return sys.executable


def run_tests(
    *,
    path: str = "backend/tests",
    quiet: bool = True,
    timeout_sec: int = 120,
) -> dict:
    """Execute pytest; never raises — returns ok/failed payload."""
    tests_dir = PROJECT_ROOT / path if not Path(path).is_absolute() else Path(path)
    if not tests_dir.exists():
        return {
            "ok": False,
            "exit_code": -1,
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "errors": 0,
            "duration_sec": 0,
            "summary": f"Tests path not found: {tests_dir}",
            "output": "",
            "command": [],
        }

    py = _python_bin()
    cmd = [
        py,
        "-m",
        "pytest",
        str(tests_dir),
        "--asyncio-mode=auto",
        "-ra",
    ]
    if quiet:
        cmd.append("-q")
    else:
        cmd.extend(["-v", "--tb=short"])

    env = os.environ.copy()
    env["PYTHONPATH"] = str(PROJECT_ROOT / "backend")
    # Avoid picking up a running app's ports for accidental binds in tests
    env.setdefault("PYTEST_CURRENT_TEST", "1")

    started = time.time()
    try:
        proc = subprocess.run(
            cmd,
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            env=env,
        )
        output = (proc.stdout or "") + ("\n" + proc.stderr if proc.stderr else "")
        exit_code = proc.returncode
    except subprocess.TimeoutExpired as exc:
        output = (exc.stdout or "") + "\n" + (exc.stderr or "")
        output = str(output) + f"\nTIMEOUT after {timeout_sec}s"
        exit_code = -2
    except OSError as exc:
        return {
            "ok": False,
            "exit_code": -3,
            "passed": 0,
            "failed": 0,
            "skipped": 0,
            "errors": 1,
            "duration_sec": round(time.time() - started, 2),
            "summary": f"Cannot run pytest: {exc}",
            "output": str(exc),
            "command": cmd,
        }

    duration = round(time.time() - started, 2)
    counts = {"passed": 0, "failed": 0, "skipped": 0, "errors": 0, "xfailed": 0}
    # Prefer last matching summary line
    for line in reversed(output.splitlines()):
        if "passed" in line or "failed" in line or "error" in line:
            for m in _SUMMARY_RE.finditer(line):
                for k, v in m.groupdict().items():
                    if v is not None and k in counts:
                        counts[k] = int(v)
            if any(counts.values()):
                break

    # Fallback: count "PASSED"/"FAILED" node lines if summary missing
    if not any(counts.values()) and exit_code == 0:
        counts["passed"] = len(re.findall(r"\bPASSED\b", output)) or (
            1 if "passed" in output.lower() else 0
        )

    ok = exit_code == 0
    summary_bits = []
    if counts["passed"]:
        summary_bits.append(f"{counts['passed']} passed")
    if counts["failed"]:
        summary_bits.append(f"{counts['failed']} failed")
    if counts["errors"]:
        summary_bits.append(f"{counts['errors']} errors")
    if counts["skipped"]:
        summary_bits.append(f"{counts['skipped']} skipped")
    summary = ", ".join(summary_bits) if summary_bits else (
        "OK" if ok else f"exit={exit_code}"
    )
    summary = f"{summary} in {duration}s"

    # Truncate huge logs for API/UI
    max_chars = 12000
    if len(output) > max_chars:
        output = output[: max_chars // 2] + "\n...\n" + output[-max_chars // 2 :]

    return {
        "ok": ok,
        "exit_code": exit_code,
        "passed": counts["passed"],
        "failed": counts["failed"],
        "skipped": counts["skipped"],
        "errors": counts["errors"],
        "duration_sec": duration,
        "summary": summary,
        "output": output.strip(),
        "command": cmd,
        "tests_path": str(tests_dir),
    }
