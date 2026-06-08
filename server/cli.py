"""One-command launcher: `crewforge` (or `uv run crewforge`).

Starts the control plane and opens the studio in your browser. Designed so a
non-technical user can go from install to a working studio in one step.
"""
from __future__ import annotations

import os
import threading
import webbrowser


def main() -> None:
    import uvicorn

    host = os.environ.get("CREWFORGE_HOST", "127.0.0.1")
    port = int(os.environ.get("CREWFORGE_PORT", "8765"))
    url = f"http://{host if host != '0.0.0.0' else 'localhost'}:{port}"

    if os.environ.get("CREWFORGE_NO_BROWSER") != "1":
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()

    print(f"\n  CrewForge → {url}\n  (Ctrl+C to stop)\n")
    uvicorn.run("server.app:app", host=host, port=port, log_level="info")


if __name__ == "__main__":
    main()
