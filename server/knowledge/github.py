"""GitHub repo ingestion — download a public repo tarball and extract text files.

Uses codeload.github.com (one request, no API token, no rate-limit pain).
Private repos are out of scope for Phase 2.
"""
from __future__ import annotations

import io
import re
import tarfile
import urllib.request

_TIMEOUT = 60
_MAX_TARBALL = 80_000_000  # 80MB compressed cap
_MAX_FILE = 200_000  # bytes of text per file
_MAX_FILES = 400
_UA = "CrewForge/0.2 (knowledge ingestion; self-hosted)"

_TEXT_EXTS = {
    ".md", ".mdx", ".rst", ".txt", ".adoc",
    ".py", ".ts", ".tsx", ".js", ".jsx", ".go", ".rs", ".java", ".kt", ".rb", ".php",
    ".c", ".h", ".cpp", ".hpp", ".cs", ".swift", ".scala", ".sh", ".sql",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".env.example", ".html", ".css",
}
_SKIP_DIRS = {"node_modules", ".git", "dist", "build", "vendor", "__pycache__", ".venv", "venv", "target", ".next"}
_SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "uv.lock", "poetry.lock", "Cargo.lock", "go.sum"}


def parse_repo_url(url: str) -> tuple[str, str, str]:
    """https://github.com/owner/repo[/tree/branch[/...]] -> (owner, repo, ref)."""
    m = re.match(r"^https?://github\.com/([\w.-]+)/([\w.-]+?)(?:\.git)?(?:/tree/([^/]+))?(?:/.*)?/?$", url.strip())
    if not m:
        raise ValueError("not a GitHub repo URL (expected https://github.com/owner/repo)")
    owner, repo, ref = m.group(1), m.group(2), m.group(3) or "HEAD"
    return owner, repo, ref


def fetch_repo(url: str, on_progress=None) -> list[tuple[str, str]]:
    """Download the repo tarball and return [(path, text)] for ingestable files."""
    owner, repo, ref = parse_repo_url(url)
    tar_url = f"https://codeload.github.com/{owner}/{repo}/tar.gz/{ref}"
    req = urllib.request.Request(tar_url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        blob = resp.read(_MAX_TARBALL)

    docs: list[tuple[str, str]] = []
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        members = [m for m in tf.getmembers() if m.isfile()]
        candidates = []
        for m in members:
            # strip the "{repo}-{sha}/" prefix codeload adds
            path = m.name.split("/", 1)[1] if "/" in m.name else m.name
            parts = path.split("/")
            if any(p in _SKIP_DIRS for p in parts) or parts[-1] in _SKIP_FILES:
                continue
            name = parts[-1].lower()
            if not any(name.endswith(ext) for ext in _TEXT_EXTS) and name not in ("readme", "license", "makefile", "dockerfile"):
                continue
            if m.size > _MAX_FILE * 4:  # way too big even before decode
                continue
            candidates.append((m, path))
        candidates = candidates[:_MAX_FILES]
        for i, (m, path) in enumerate(candidates):
            f = tf.extractfile(m)
            if f is None:
                continue
            raw = f.read(_MAX_FILE)
            if b"\x00" in raw[:1024]:  # binary masquerading as text
                continue
            text = raw.decode("utf-8", errors="ignore").strip()
            if text:
                docs.append((f"{owner}/{repo}:{path}", text))
            if on_progress and (i % 20 == 0 or i == len(candidates) - 1):
                on_progress(i + 1, len(candidates))
    return docs
