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
import shutil
import threading
from pathlib import Path

BUILD_VERSION = "3.7.2"
HOST = os.getenv("BPP_PREDICTS_HOST", "127.0.0.1")
PREFERRED_PORT = int(os.getenv("BPP_PREDICTS_PORT", "8000"))
ROOT = Path(__file__).resolve().parent
CHASE_ROOT = ROOT.parent / "chasemapper"
CHASE_PORT = 5001
CHASE_STATUS_FILE = ROOT / "cache" / "live_chase_status.json"


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


def write_chase_status(status: str, message: str) -> None:
    """Publish launcher progress for the browser's Live CHASE waiting page."""
    try:
        CHASE_STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
        temporary = CHASE_STATUS_FILE.with_suffix(".tmp")
        temporary.write_text(
            json.dumps({"status": status, "message": message, "updated_at": time.time()}),
            encoding="utf-8",
        )
        temporary.replace(CHASE_STATUS_FILE)
    except OSError:
        pass


def docker_executable() -> str | None:
    found = shutil.which("docker")
    if found:
        return found
    if os.name != "nt":
        return None
    program_files = Path(os.environ.get("ProgramFiles", r"C:\Program Files"))
    candidate = program_files / "Docker" / "Docker" / "resources" / "bin" / "docker.exe"
    return str(candidate) if candidate.exists() else None


def docker_desktop_executable() -> Path | None:
    if os.name != "nt":
        return None
    candidates = [
        Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Docker" / "Docker" / "Docker Desktop.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Docker" / "Docker Desktop.exe",
    ]
    return next((candidate for candidate in candidates if candidate.exists()), None)


def docker_engine_ready(docker: str) -> bool:
    try:
        result = subprocess.run(
            [docker, "info"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=10,
            check=False,
        )
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def ensure_docker_engine(docker: str) -> bool:
    if docker_engine_ready(docker):
        return True
    desktop = docker_desktop_executable()
    if desktop is None:
        write_chase_status("blocked", "Docker Desktop is not running. Start Docker Desktop, then reopen Live CHASE.")
        print("[BPP Live CHASE] Docker Desktop is not running. Start it to use Live CHASE.")
        return False
    write_chase_status("starting", "Starting Docker Desktop…")
    print("[BPP Live CHASE] Starting Docker Desktop…")
    try:
        subprocess.Popen([str(desktop)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    except OSError as exc:
        write_chase_status("error", f"Docker Desktop could not be started: {exc}")
        return False
    deadline = time.time() + 120
    while time.time() < deadline:
        if docker_engine_ready(docker):
            return True
        time.sleep(2)
    write_chase_status("error", "Docker Desktop did not become ready. Open Docker Desktop and wait for it to finish starting.")
    print("[BPP Live CHASE] Docker Desktop did not become ready within two minutes.")
    return False


def start_live_chase() -> bool:
    """Start the complete vendored ChaseMapper stack when Docker is available."""
    if os.getenv("BPP_SKIP_LIVE_CHASE", "").strip().lower() in {"1", "true", "yes"}:
        write_chase_status("blocked", "Live CHASE startup was disabled by BPP_SKIP_LIVE_CHASE.")
        print("[BPP Live CHASE] Startup skipped by BPP_SKIP_LIVE_CHASE.")
        return False
    if port_is_open(CHASE_PORT):
        write_chase_status("ready", "Live CHASE is ready.")
        print(f"[BPP Live CHASE] Already available at http://127.0.0.1:{CHASE_PORT}/")
        return True
    if not CHASE_ROOT.exists():
        write_chase_status("error", "The packaged ChaseMapper system is missing.")
        print("[BPP Live CHASE] The vendored ChaseMapper directory is missing.")
        return False
    docker = docker_executable()
    if not docker:
        write_chase_status("blocked", "Docker Desktop is required for Live CHASE but was not found. Install Docker Desktop and restart Predicts.")
        print("[BPP Live CHASE] Docker Desktop was not found. Predicts will still run; install/start Docker Desktop to use Live CHASE.")
        return False
    if not ensure_docker_engine(docker):
        return False
    try:
        check = subprocess.run(
            [docker, "compose", "version"],
            cwd=CHASE_ROOT,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            timeout=12,
            check=False,
        )
        if check.returncode != 0:
            write_chase_status("error", "Docker Compose is unavailable. Update Docker Desktop and try again.")
            print("[BPP Live CHASE] Docker Compose is unavailable. Predicts will still run.")
            return False
        write_chase_status("building", "Building and starting Live CHASE. The first launch can take several minutes…")
        print("[BPP Live CHASE] Starting the complete ChaseMapper server (the first build can take several minutes)...")
        result = subprocess.run(
            [docker, "compose", "up", "-d", "--build"],
            cwd=CHASE_ROOT,
            check=False,
        )
        if result.returncode != 0:
            write_chase_status("error", "Docker could not build or start Live CHASE. Review the launcher window for the Docker error.")
            print("[BPP Live CHASE] Docker could not start ChaseMapper. Review the Docker output above.")
            return False
        deadline = time.time() + 90
        while time.time() < deadline:
            if port_is_open(CHASE_PORT):
                write_chase_status("ready", "Live CHASE is ready.")
                print(f"[BPP Live CHASE] Ready at http://127.0.0.1:{CHASE_PORT}/")
                return True
            time.sleep(0.5)
        write_chase_status("starting", "The Live CHASE container is still initializing…")
        print("[BPP Live CHASE] Container started but port 5001 is not ready yet. It may still be initializing.")
        return False
    except (OSError, subprocess.SubprocessError) as exc:
        write_chase_status("error", f"Docker could not start Live CHASE: {exc}")
        print(f"[BPP Live CHASE] Could not start Docker: {exc}")
        return False


def main() -> int:
    print(f"[BPP Predicts] Current build: v{BUILD_VERSION}")
    write_chase_status("starting", "Preparing Live CHASE…")
    # Do not make the planning interface wait for Docker Desktop or the first
    # ChaseMapper image build. The Live CHASE tab waits and redirects when ready.
    chase_thread = threading.Thread(target=start_live_chase, name="bpp-live-chase-startup", daemon=True)
    chase_thread.start()
    already_current = remove_old_bpp_instances()
    if already_current:
        data = health(PREFERRED_PORT, timeout=1.2)
        if is_bpp_health(data) and data.get("version") == BUILD_VERSION:
            print("[BPP Predicts] The newest build is already running. No second server will be started.")
            open_current(PREFERRED_PORT)
            # With no child server to keep this launcher alive, allow the chase
            # startup attempt to finish before the process exits.
            if not port_is_open(CHASE_PORT):
                chase_thread.join()
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
