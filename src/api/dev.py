"""Start FastAPI and Vite together, and stop both when either exits."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from contextlib import suppress
from pathlib import Path
from types import FrameType

ROOT = Path(__file__).resolve().parents[2]


def _signal_group(pid: int, signum: int) -> None:
    with suppress(ProcessLookupError):
        os.killpg(pid, signum)


def _group_exists(pid: int) -> bool:
    try:
        os.killpg(pid, 0)
    except ProcessLookupError:
        return False
    return True


def _stop(processes: list[subprocess.Popen[bytes]]) -> None:
    for process in processes:
        _signal_group(process.pid, signal.SIGTERM)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        for process in processes:
            process.poll()
        if not any(_group_exists(process.pid) for process in processes):
            return
        time.sleep(0.1)
    for process in processes:
        _signal_group(process.pid, signal.SIGKILL)
        process.wait()


def main() -> int:
    stopping = False

    def request_stop(_signum: int, _frame: FrameType | None) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)
    commands = (
        [
            sys.executable, "-m", "uvicorn", "api.main:app", "--reload",
            "--host", "127.0.0.1", "--port", "8000",
        ],
        ["npm", "--prefix", "web", "run", "dev", "--", "--port", "5173", "--strictPort"],
    )
    processes: list[subprocess.Popen[bytes]] = []
    try:
        for command in commands:
            if stopping:
                return 0
            processes.append(subprocess.Popen(command, cwd=ROOT, start_new_session=True))
        print("HomeoRemedica: http://127.0.0.1:5173 (Ctrl+C stops both servers)", flush=True)
        while not stopping:
            for process in processes:
                returncode = process.poll()
                if returncode is not None:
                    return returncode if returncode >= 0 else 1
            time.sleep(0.1)
        return 0
    except OSError as error:
        print(f"Could not start the web app: {error}", file=sys.stderr)
        return 1
    finally:
        _stop(processes)


if __name__ == "__main__":
    raise SystemExit(main())
