import os
import shutil
import signal
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IS_WINDOWS = os.name == "nt"


def find_npm():
    npm = shutil.which("npm.cmd" if IS_WINDOWS else "npm") or shutil.which("npm")
    if not npm:
        print("npm was not found on PATH. Please install Node.js first.")
    return npm


def ensure_dependencies(npm):
    bin_name = "concurrently.cmd" if IS_WINDOWS else "concurrently"
    if (ROOT / "node_modules" / ".bin" / bin_name).exists():
        return True
    print("Installing dependencies (npm install)...")
    return subprocess.run([npm, "install"], cwd=ROOT).returncode == 0


def stop_process(proc):
    if proc.poll() is not None:
        return
    if IS_WINDOWS:
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    else:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    try:
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def start_app():
    npm = find_npm()
    if not npm or not ensure_dependencies(npm):
        return

    print("\nStarting backend and frontend (watch the output below for the URLs)...")
    print("Press Ctrl+C to stop and return to the menu.\n")

    popen_kwargs = {"cwd": ROOT}
    if not IS_WINDOWS:
        popen_kwargs["start_new_session"] = True
    proc = subprocess.Popen([npm, "run", "dev"], **popen_kwargs)

    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\nStopping frontend and backend...")
    finally:
        stop_process(proc)
    print("App stopped.")


def main():
    actions = {"1": start_app}
    while True:
        print("\n=== Mark Your Territory ===")
        print("1. Start the app (Frontend + Backend)")
        print("2. Exit")
        try:
            choice = input("Choose an option: ").strip()
        except (KeyboardInterrupt, EOFError):
            print()
            break

        if choice == "2":
            break
        action = actions.get(choice)
        if action:
            action()
        else:
            print("Invalid option, please enter 1 or 2.")

    print("Goodbye!")
    sys.exit(0)


if __name__ == "__main__":
    main()
