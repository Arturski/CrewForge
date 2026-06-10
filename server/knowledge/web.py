"""Web ingestion — fetch a page (or crawl a docs site) into plain text.

Stdlib only (urllib + html.parser): no new dependencies, works offline-first.
Single page by default; crawl=True follows same-host links breadth-first up
to max_pages. Designed for docs sites, not the open web.
"""
from __future__ import annotations

import html
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser

_TIMEOUT = 15
_MAX_BYTES = 2_000_000  # per page
_UA = "CrewForge/0.2 (knowledge ingestion; self-hosted)"

# Content inside these tags is boilerplate, not knowledge.
_SKIP_TAGS = {"script", "style", "noscript", "svg", "nav", "footer", "header", "aside", "form"}
# These tags imply a paragraph break when rendering text.
_BLOCK_TAGS = {"p", "div", "section", "article", "li", "br", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "td"}


class _TextAndLinks(HTMLParser):
    """One pass: visible text + same-document links + <title>."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.links: list[str] = []
        self.title = ""
        self._skip_depth = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIP_TAGS:
            self._skip_depth += 1
        if tag == "title":
            self._in_title = True
        if tag == "a":
            href = dict(attrs).get("href")
            if href:
                self.links.append(href)
        if tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in _SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1
        if tag == "title":
            self._in_title = False
        if tag in _BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
            return
        if not self._skip_depth and data.strip():
            self.parts.append(data)


def _clean(parts: list[str]) -> str:
    text = html.unescape("".join(parts))
    lines = [ln.strip() for ln in text.splitlines()]
    out: list[str] = []
    for ln in lines:
        if ln:
            out.append(ln)
        elif out and out[-1] != "":
            out.append("")
    return "\n".join(out).strip()


def fetch_page(url: str) -> tuple[str, str, list[str]]:
    """(title, text, absolute same-host links). Raises on non-HTML or fetch errors."""
    scheme = urllib.parse.urlparse(url).scheme
    if scheme not in ("http", "https"):
        raise ValueError(f"unsupported URL scheme: {scheme or '(none)'}")
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=_TIMEOUT) as resp:
        ctype = resp.headers.get("content-type", "")
        if "html" not in ctype and "text" not in ctype:
            raise ValueError(f"not a text page (content-type: {ctype.split(';')[0]})")
        body = resp.read(_MAX_BYTES).decode(resp.headers.get_content_charset() or "utf-8", errors="ignore")
        final_url = resp.url  # after redirects
    parser = _TextAndLinks()
    parser.feed(body)
    base = urllib.parse.urlparse(final_url)
    links: list[str] = []
    for href in parser.links:
        absu = urllib.parse.urljoin(final_url, href.split("#")[0])
        p = urllib.parse.urlparse(absu)
        if p.scheme in ("http", "https") and p.netloc == base.netloc and absu != final_url:
            links.append(absu)
    return parser.title.strip(), _clean(parser.parts), list(dict.fromkeys(links))


def crawl(start_url: str, max_pages: int = 30, on_progress=None) -> list[tuple[str, str]]:
    """BFS same-host crawl from start_url. Returns [(url, text)] for pages with content.

    on_progress(done, total_queued) is called after each fetch so the caller can
    surface live status. Fetch errors on non-start pages are skipped silently.
    """
    seen: set[str] = set()
    queue: list[str] = [start_url]
    docs: list[tuple[str, str]] = []
    while queue and len(seen) < max_pages:
        url = queue.pop(0)
        if url in seen:
            continue
        seen.add(url)
        try:
            _, text, links = fetch_page(url)
        except (urllib.error.URLError, ValueError, TimeoutError, OSError):
            if url == start_url:
                raise  # the entry page must work; otherwise the source is an error
            continue
        if text:
            docs.append((url, text))
        for ln in links:
            if ln not in seen and ln not in queue and len(seen) + len(queue) < max_pages * 3:
                queue.append(ln)
        if on_progress:
            on_progress(len(seen), min(len(seen) + len(queue), max_pages))
    return docs
