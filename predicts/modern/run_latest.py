from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

BUILD_VERSION = "3.8.0"
HOST = os.getenv("BPP_PREDICTS_HOST", "127.0.0.1")
PREFERRED_PORT = int(os.getenv("BPP_PREDICTS_PORT", "8000"))
ROOT = Path(__file__).resolve().parent


def health(port: int, timeout: float = 0.55) -> dict | None:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=timeout) as response:
            data = json.loads(response.read().decode("utf-8"))
        return data if isinstance(data, dict) else None
    except (OSError, ValueError, urllib.error.URLError):
        return None


def is_bpp_health(data: dict | None) -> bool:
    return bool(
        data
        and data.get("status") == "ok"
        and isinstance(data.get("version"), str)
        and "tawhiri_url" in data
    )


def port_is_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.25):
            return True
    except OSError:
        return False


def listener_pids_windows(port: int) -> list[int]:
    command = (
        "$p=(Get-NetTCPConnection -LocalPort "
        f"{port} -State Listen -ErrorAction SilentlyContinue).OwningProcess; "
        "$p | Sort-Object -Unique"
    )
    try:
        result = subprocess.run(
            ["powershell", "-NoProfile", "-Command", command],
            capture_output=True,
            text=True,
            timeout=4,
            check=False,
        )
        return [int(line.strip()) for line in result.stdout.splitlines() if line.strip().isdigit()]
    except (OSError, subprocess.SubprocessError, ValueError):
        return []


def listener_pids_unix(port: int) -> list[int]:
    for command in (["lsof", "-tiTCP:%d" % port, "-sTCP:LISTEN"], ["fuser", "%d/tcp" % port]):
        try:
            result = subprocess.run(command, capture_output=True, text=True, timeout=3, check=False)
            values = []
            for token in (result.stdout + " " + result.stderr).replace("/tcp:", " ").split():
                if token.isdigit():
                    values.append(int(token))
            if values:
                return sorted(set(values))
        except (OSError, subprocess.SubprocessError):
            continue
    return []


def listener_pids(port: int) -> list[int]:
    return listener_pids_windows(port) if os.name == "nt" else listener_pids_unix(port)


def kill_pid(pid: int) -> bool:
    if pid == os.getpid():
        return False
    try:
        if os.name == "nt":
            result = subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                text=True,
                timeout=6,
                check=False,
            )
            return result.returncode == 0
        os.kill(pid, 15)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def stop_bpp_server(port: int, data: dict) -> None:
    version = data.get("version", "unknown")
    pids = listener_pids(port)
    if not pids:
        print(f"[BPP Predicts] Found BPP Predicts v{version} on port {port}, but could not identify its process.")
        return
    print(f"[BPP Predicts] Stopping previously running BPP Predicts v{version} on port {port}...")
    for pid in pids:
        kill_pid(pid)
    deadline = time.time() + 4
    while time.time() < deadline and port_is_open(port):
        time.sleep(0.12)


def remove_old_bpp_instances() -> bool:
    """Stop old BPP Predicts servers; return True if this build is already running."""
    current_on_preferred = False
    ports = sorted(set([PREFERRED_PORT, *range(8000, 8011)]))
    for port in ports:
        data = health(port)
        if not is_bpp_health(data):
            continue
        if data.get("version") == BUILD_VERSION and port == PREFERRED_PORT:
            current_on_preferred = True
            continue
        stop_bpp_server(port, data)
    return current_on_preferred


def choose_port() -> int:
    if not port_is_open(PREFERRED_PORT):
        return PREFERRED_PORT
    for port in range(8001, 8021):
        if not port_is_open(port):
            print(f"[BPP Predicts] Port {PREFERRED_PORT} is used by another application; using {port} instead.")
            return port
    raise RuntimeError("No free local port was found between 8000 and 8020.")


def open_current(port: int) -> None:
    url = f"http://127.0.0.1:{port}/?build={BUILD_VERSION}&t={int(time.time())}"
    print(f"[BPP Predicts] Opening current build v{BUILD_VERSION}: {url}")
    webbrowser.open(url, new=2)


def main() -> int:
    print(f"[BPP Predicts] Current build: v{BUILD_VERSION}")
    already_current = remove_old_bpp_instances()
    if already_current:
        data = health(PREFERRED_PORT, timeout=1.2)
        if is_bpp_health(data) and data.get("version") == BUILD_VERSION:
            print("[BPP Predicts] The newest build is already running. No second server will be started.")
            open_current(PREFERRED_PORT)
            return 0

    port = choose_port()
    env = os.environ.copy()
    env["BPP_PREDICTS_HOST"] = HOST
    env["BPP_PREDICTS_PORT"] = str(port)

    child = subprocess.Popen([sys.executable, str(ROOT / "app.py")], cwd=ROOT, env=env)
    try:
        deadline = time.time() + 18
        while time.time() < deadline:
            if child.poll() is not None:
                print(f"[BPP Predicts] Server exited during startup with code {child.returncode}.")
                return child.returncode or 1
            data = health(port, timeout=0.8)
            if is_bpp_health(data) and data.get("version") == BUILD_VERSION:
                print(f"[BPP Predicts] Verified v{BUILD_VERSION} on port {port}.")
                open_current(port)
                print("[BPP Predicts] Keep this window open while using Predicts. Press Ctrl+C to stop it.")
                return child.wait()
            time.sleep(0.25)

        print("[BPP Predicts] The server did not become healthy in time.")
        child.terminate()
        return 1
    except KeyboardInterrupt:
        print("\n[BPP Predicts] Stopping current server...")
        child.terminate()
        try:
            child.wait(timeout=4)
        except subprocess.TimeoutExpired:
            child.kill()
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
