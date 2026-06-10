"""Knowledge Phase 2 unit tests — HTML extraction + GitHub URL parsing. No network."""
import pytest

from server.knowledge.github import parse_repo_url
from server.knowledge.web import _clean, _TextAndLinks


def _parse(html_src: str) -> _TextAndLinks:
    p = _TextAndLinks()
    p.feed(html_src)
    return p


def test_html_text_extraction_strips_boilerplate():
    p = _parse("""
    <html><head><title>My Docs</title><style>.x{color:red}</style></head>
    <body>
      <nav><a href="/skip">Navigation junk</a></nav>
      <article><h1>Welcome</h1><p>Real content here.</p></article>
      <script>alert('nope')</script>
      <footer>Copyright junk</footer>
    </body></html>
    """)
    text = _clean(p.parts)
    assert p.title == "My Docs"
    assert "Real content here." in text
    assert "Welcome" in text
    assert "Navigation junk" not in text
    assert "alert" not in text
    assert "Copyright junk" not in text


def test_html_link_collection():
    p = _parse('<a href="/a">A</a> <a href="https://other.com/b">B</a> <a href="#frag">C</a>')
    assert "/a" in p.links and "https://other.com/b" in p.links


def test_parse_repo_url_variants():
    assert parse_repo_url("https://github.com/owner/repo") == ("owner", "repo", "HEAD")
    assert parse_repo_url("https://github.com/owner/repo.git") == ("owner", "repo", "HEAD")
    assert parse_repo_url("https://github.com/owner/repo/tree/main") == ("owner", "repo", "main")
    assert parse_repo_url("https://github.com/o-w.n/r.e-po/tree/dev/sub/dir") == ("o-w.n", "r.e-po", "dev")


def test_parse_repo_url_rejects_non_github():
    with pytest.raises(ValueError):
        parse_repo_url("https://gitlab.com/owner/repo")
    with pytest.raises(ValueError):
        parse_repo_url("not a url")
