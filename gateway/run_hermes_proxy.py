"""Launch the independent Hermes Nous forwarding proxy, without touching the chat gateway."""
import os
from pathlib import Path
import socket
import subprocess
import sys
from duallens_gateway import proxy_environment

def main():
    try:
        with socket.create_connection(("127.0.0.1", 8645), timeout=1):
            return 0
    except OSError:
        pass
    exe = Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData/Local"))) / "hermes/bin/hermes.exe"
    home = Path.home() / ".duallens"
    home.mkdir(exist_ok=True)
    flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
    try:
        result = subprocess.run([str(exe), "proxy", "start", "--provider", "nous",
                                 "--host", "127.0.0.1", "--port", "8645"],
                                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                cwd=home, env=proxy_environment(), creationflags=flags)
        return result.returncode
    except OSError:
        return 1

if __name__ == "__main__":
    sys.exit(main())
