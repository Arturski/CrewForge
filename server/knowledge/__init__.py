"""Knowledge bases: ingest sources -> chunk -> embed (local) -> searchable by agents."""
from .kb import add_source, create_kb, delete_kb, get_kb, list_kbs, search

__all__ = ["create_kb", "list_kbs", "get_kb", "delete_kb", "add_source", "search"]
