"""Embedded Kuzu graph per knowledge base.

Schema: (Chunk)-[MENTIONS]->(Entity)-[RELATED {label}]->(Entity).
One Kuzu directory per KB under `knowledge_graphs/` next to the SQLite DB
(gitignored runtime state, like the DB itself). Kuzu locks a database dir per
process, so Database handles are cached and writes serialized with a lock.
"""
from __future__ import annotations

import re
import shutil
import threading
from pathlib import Path
from typing import Any

from .. import store

_dbs: dict[str, Any] = {}
_lock = threading.Lock()

_SCHEMA = [
    "CREATE NODE TABLE IF NOT EXISTS Chunk(id STRING, source STRING, PRIMARY KEY(id))",
    "CREATE NODE TABLE IF NOT EXISTS Entity(name STRING, type STRING, display STRING, PRIMARY KEY(name))",
    "CREATE REL TABLE IF NOT EXISTS MENTIONS(FROM Chunk TO Entity)",
    "CREATE REL TABLE IF NOT EXISTS RELATED(FROM Entity TO Entity, label STRING)",
]


def _path(kb_id: str) -> Path:
    return store._DB_PATH.parent / "knowledge_graphs" / kb_id


def exists(kb_id: str) -> bool:
    return _path(kb_id).exists()


def _connect(kb_id: str):
    import kuzu
    with _lock:
        db = _dbs.get(kb_id)
        if db is None:
            path = _path(kb_id)
            path.parent.mkdir(parents=True, exist_ok=True)
            db = _dbs[kb_id] = kuzu.Database(str(path))
            conn = kuzu.Connection(db)
            for stmt in _SCHEMA:
                conn.execute(stmt)
            return conn
    return kuzu.Connection(db)


def _key(name: str) -> str:
    return re.sub(r"\s+", " ", str(name)).strip().lower()


def _rows(result) -> list[list[Any]]:
    out = []
    while result.has_next():
        out.append(result.get_next())
    return out


def add_chunk(kb_id: str, chunk_id: str, source: str,
              entities: list[dict[str, Any]], relations: list[dict[str, Any]]) -> None:
    """Upsert one chunk's extraction: entities, MENTIONS edges, RELATED edges."""
    conn = _connect(kb_id)
    with _lock:
        conn.execute("MERGE (c:Chunk {id: $id}) ON CREATE SET c.source=$src",
                     {"id": chunk_id, "src": source or ""})
        seen: set[str] = set()
        for e in entities:
            k = _key(e.get("name", ""))
            if not k or k in seen:
                continue
            seen.add(k)
            conn.execute(
                "MERGE (e:Entity {name: $n}) ON CREATE SET e.type=$t, e.display=$d",
                {"n": k, "t": str(e.get("type", ""))[:40], "d": str(e.get("name", ""))[:120]})
            conn.execute(
                "MATCH (c:Chunk {id: $id}), (e:Entity {name: $n}) MERGE (c)-[:MENTIONS]->(e)",
                {"id": chunk_id, "n": k})
        for r in relations:
            a, b = _key(r.get("source", "")), _key(r.get("target", ""))
            label = re.sub(r"\s+", " ", str(r.get("label", "related to"))).strip()[:80]
            if not a or not b or a == b:
                continue
            for k in (a, b):
                if k not in seen:
                    seen.add(k)
                    conn.execute("MERGE (e:Entity {name: $n}) ON CREATE SET e.type='', e.display=$d",
                                 {"n": k, "d": k})
            conn.execute(
                "MATCH (a:Entity {name: $a}), (b:Entity {name: $b}) "
                "MERGE (a)-[r:RELATED {label: $l}]->(b)",
                {"a": a, "b": b, "l": label or "related to"})


def graphed_chunks(kb_id: str) -> set[str]:
    if not exists(kb_id):
        return set()
    rows = _rows(_connect(kb_id).execute("MATCH (c:Chunk) RETURN c.id"))
    return {r[0] for r in rows}


def stats(kb_id: str) -> dict[str, int]:
    if not exists(kb_id):
        return {"entities": 0, "relations": 0, "chunks": 0}
    conn = _connect(kb_id)
    ents = _rows(conn.execute("MATCH (e:Entity) RETURN COUNT(e)"))[0][0]
    rels = _rows(conn.execute("MATCH (:Entity)-[r:RELATED]->(:Entity) RETURN COUNT(r)"))[0][0]
    chunks = _rows(conn.execute("MATCH (c:Chunk) RETURN COUNT(c)"))[0][0]
    return {"entities": int(ents), "relations": int(rels), "chunks": int(chunks)}


def overview(kb_id: str, limit: int = 60) -> dict[str, list[dict[str, Any]]]:
    """Top entities by degree + the RELATED edges among them (for the viz)."""
    if not exists(kb_id):
        return {"entities": [], "relations": []}
    conn = _connect(kb_id)
    ents = _rows(conn.execute(
        "MATCH (e:Entity) OPTIONAL MATCH (e)-[r]-() "
        "RETURN e.name, e.display, e.type, COUNT(r) AS deg ORDER BY deg DESC, e.name LIMIT $lim",
        {"lim": limit}))
    names = {r[0] for r in ents}
    rels = _rows(conn.execute(
        "MATCH (a:Entity)-[r:RELATED]->(b:Entity) RETURN a.name, r.label, b.name"))
    return {
        "entities": [{"name": r[0], "label": r[1] or r[0], "type": r[2] or "", "degree": int(r[3])}
                     for r in ents],
        "relations": [{"source": a, "label": lbl, "target": b}
                      for a, lbl, b in rels if a in names and b in names],
    }


def related_facts(kb_id: str, chunk_ids: list[str], limit: int = 12) -> list[dict[str, str]]:
    """1-hop entity facts connected to the given chunks (hybrid retrieval)."""
    if not chunk_ids or not exists(kb_id):
        return []
    conn = _connect(kb_id)
    # Directed match keeps "A works at B" from also surfacing as "B works at A".
    rows = _rows(conn.execute(
        "MATCH (c:Chunk)-[:MENTIONS]->(e:Entity), (a:Entity)-[r:RELATED]->(b:Entity) "
        "WHERE c.id IN $ids AND (a.name = e.name OR b.name = e.name) "
        "RETURN DISTINCT a.display, r.label, b.display LIMIT $lim",
        {"ids": list(chunk_ids), "lim": limit}))
    return [{"source": a, "label": lbl, "target": b} for a, lbl, b in rows]


def delete(kb_id: str) -> None:
    with _lock:
        db = _dbs.pop(kb_id, None)
        if db is not None:
            db.close()
        # Kuzu stores a file plus sidecars (.wal, …) at the path, not a directory.
        base = _path(kb_id)
        for p in base.parent.glob(base.name + "*") if base.parent.exists() else []:
            shutil.rmtree(p, ignore_errors=True) if p.is_dir() else p.unlink(missing_ok=True)
