"""Persistence — stdlib sqlite3 with JSON blobs (zero-config, single-user).

Self-hosted CrewForge defaults to a local SQLite file so it works on first run
with no database to provision. Set CREWFORGE_DB to relocate it. (Postgres is a
future drop-in for multi-tenant deployments.)

Connection-per-operation keeps this thread-safe across the run worker's pool
threads without shared-connection locking. WAL mode allows concurrent readers.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import threading
from pathlib import Path
from typing import Any

_DB_PATH = Path(os.environ.get("CREWFORGE_DB", Path(__file__).resolve().parent.parent / "crewforge.db"))
_init_lock = threading.Lock()
_initialized = False


def _now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def _conn() -> sqlite3.Connection:
    c = sqlite3.connect(_DB_PATH, timeout=10, check_same_thread=False)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("PRAGMA busy_timeout=5000")
    return c


def init() -> None:
    global _initialized
    with _init_lock:
        if _initialized:
            return
        with _conn() as c:
            c.executescript(
                """
                CREATE TABLE IF NOT EXISTS workspaces (
                    id TEXT PRIMARY KEY, name TEXT, updated_at TEXT, data TEXT
                );
                CREATE TABLE IF NOT EXISTS runs (
                    id TEXT PRIMARY KEY, workspace_id TEXT, started_at TEXT, data TEXT
                );
                CREATE TABLE IF NOT EXISTS events (
                    run_id TEXT, seq INTEGER, data TEXT,
                    PRIMARY KEY (run_id, seq)
                );
                CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
                CREATE TABLE IF NOT EXISTS personas (id TEXT PRIMARY KEY, data TEXT, seeded INTEGER DEFAULT 0);
                CREATE TABLE IF NOT EXISTS knowledge_bases (id TEXT PRIMARY KEY, name TEXT, data TEXT);
                CREATE TABLE IF NOT EXISTS kb_sources (id TEXT PRIMARY KEY, kb_id TEXT, data TEXT);
                CREATE TABLE IF NOT EXISTS kb_chunks (
                    kb_id TEXT, chunk_id TEXT, source_id TEXT, text TEXT, emb TEXT, meta TEXT,
                    PRIMARY KEY (kb_id, chunk_id)
                );
                CREATE TABLE IF NOT EXISTS schedules (id TEXT PRIMARY KEY, workspace_id TEXT, data TEXT);
                """
            )
        _seed_if_empty()
        _initialized = True


def _seed_if_empty() -> None:
    from .personas import PERSONAS  # local import to avoid cycle
    from .seed import WORKSPACES  # local import to avoid cycle
    with _conn() as c:
        if c.execute("SELECT COUNT(*) FROM workspaces").fetchone()[0] == 0:
            for ws in WORKSPACES.values():
                c.execute(
                    "INSERT INTO workspaces (id, name, updated_at, data) VALUES (?,?,?,?)",
                    (ws["id"], ws["name"], _now(), json.dumps(ws)),
                )
        if c.execute("SELECT COUNT(*) FROM personas").fetchone()[0] == 0:
            for p in PERSONAS:
                c.execute("INSERT INTO personas (id, data, seeded) VALUES (?,?,1)",
                          (p["id"], json.dumps(p)))


# -- schedules ---------------------------------------------------------------
def list_schedules(workspace_id: str | None = None) -> list[dict[str, Any]]:
    with _conn() as c:
        if workspace_id:
            rows = c.execute("SELECT data FROM schedules WHERE workspace_id=? ORDER BY id",
                             (workspace_id,)).fetchall()
        else:
            rows = c.execute("SELECT data FROM schedules ORDER BY id").fetchall()
    return [json.loads(r["data"]) for r in rows]


def get_schedule(sid: str) -> dict[str, Any] | None:
    with _conn() as c:
        row = c.execute("SELECT data FROM schedules WHERE id=?", (sid,)).fetchone()
    return json.loads(row["data"]) if row else None


def save_schedule(s: dict[str, Any]) -> dict[str, Any]:
    with _conn() as c:
        c.execute("INSERT INTO schedules (id, workspace_id, data) VALUES (?,?,?) "
                  "ON CONFLICT(id) DO UPDATE SET workspace_id=excluded.workspace_id, data=excluded.data",
                  (s["id"], s.get("workspace_id", ""), json.dumps(s)))
    return s


def delete_schedule(sid: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM schedules WHERE id=?", (sid,))


# -- personas ----------------------------------------------------------------
def list_personas() -> list[dict[str, Any]]:
    with _conn() as c:
        rows = c.execute("SELECT data FROM personas ORDER BY seeded DESC, id").fetchall()
    return [json.loads(r["data"]) for r in rows]


def save_persona(p: dict[str, Any]) -> dict[str, Any]:
    with _conn() as c:
        c.execute("INSERT INTO personas (id, data, seeded) VALUES (?,?,0) "
                  "ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                  (p["id"], json.dumps(p)))
    return p


def delete_persona(pid: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM personas WHERE id=?", (pid,))


# -- knowledge bases ---------------------------------------------------------
def list_kbs() -> list[dict[str, Any]]:
    with _conn() as c:
        rows = c.execute("SELECT data FROM knowledge_bases ORDER BY name").fetchall()
    return [json.loads(r["data"]) for r in rows]


def get_kb(kb_id: str) -> dict[str, Any] | None:
    with _conn() as c:
        row = c.execute("SELECT data FROM knowledge_bases WHERE id=?", (kb_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def save_kb(kb: dict[str, Any]) -> dict[str, Any]:
    with _conn() as c:
        c.execute("INSERT INTO knowledge_bases (id, name, data) VALUES (?,?,?) "
                  "ON CONFLICT(id) DO UPDATE SET name=excluded.name, data=excluded.data",
                  (kb["id"], kb.get("name", "KB"), json.dumps(kb)))
    return kb


def delete_kb(kb_id: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM knowledge_bases WHERE id=?", (kb_id,))
        c.execute("DELETE FROM kb_sources WHERE kb_id=?", (kb_id,))
        c.execute("DELETE FROM kb_chunks WHERE kb_id=?", (kb_id,))


def list_sources(kb_id: str) -> list[dict[str, Any]]:
    with _conn() as c:
        rows = c.execute("SELECT data FROM kb_sources WHERE kb_id=?", (kb_id,)).fetchall()
    return [json.loads(r["data"]) for r in rows]


def save_source(src: dict[str, Any]) -> dict[str, Any]:
    with _conn() as c:
        c.execute("INSERT INTO kb_sources (id, kb_id, data) VALUES (?,?,?) "
                  "ON CONFLICT(id) DO UPDATE SET data=excluded.data",
                  (src["id"], src["kb_id"], json.dumps(src)))
    return src


def add_chunks(kb_id: str, source_id: str, rows: list[tuple[str, str, list[float], dict]]) -> None:
    with _conn() as c:
        c.executemany(
            "INSERT OR REPLACE INTO kb_chunks (kb_id, chunk_id, source_id, text, emb, meta) VALUES (?,?,?,?,?,?)",
            [(kb_id, cid, source_id, text, json.dumps(emb), json.dumps(meta)) for cid, text, emb, meta in rows],
        )


def get_chunks(kb_id: str) -> list[dict[str, Any]]:
    with _conn() as c:
        rows = c.execute("SELECT chunk_id, source_id, text, emb, meta FROM kb_chunks WHERE kb_id=?", (kb_id,)).fetchall()
    return [{"chunk_id": r["chunk_id"], "source_id": r["source_id"], "text": r["text"],
             "emb": json.loads(r["emb"]), "meta": json.loads(r["meta"])} for r in rows]


def count_chunks(kb_id: str) -> int:
    with _conn() as c:
        return c.execute("SELECT COUNT(*) FROM kb_chunks WHERE kb_id=?", (kb_id,)).fetchone()[0]


# -- workspaces --------------------------------------------------------------
def list_workspaces() -> list[dict[str, Any]]:
    with _conn() as c:
        rows = c.execute("SELECT data FROM workspaces ORDER BY updated_at DESC").fetchall()
    return [json.loads(r["data"]) for r in rows]


def get_workspace(ws_id: str) -> dict[str, Any] | None:
    with _conn() as c:
        row = c.execute("SELECT data FROM workspaces WHERE id=?", (ws_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def save_workspace(ws: dict[str, Any]) -> dict[str, Any]:
    with _conn() as c:
        c.execute(
            "INSERT INTO workspaces (id, name, updated_at, data) VALUES (?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET name=excluded.name, "
            "updated_at=excluded.updated_at, data=excluded.data",
            (ws["id"], ws.get("name", "Untitled"), _now(), json.dumps(ws)),
        )
    return ws


def delete_workspace(ws_id: str) -> None:
    with _conn() as c:
        c.execute("DELETE FROM workspaces WHERE id=?", (ws_id,))


# -- runs & events -----------------------------------------------------------
def create_run(rec: dict[str, Any]) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO runs (id, workspace_id, started_at, data) VALUES (?,?,?,?)",
            (rec["id"], rec.get("workspace_id", ""), rec["started_at"], json.dumps(rec)),
        )


def update_run(rec: dict[str, Any]) -> None:
    with _conn() as c:
        c.execute("UPDATE runs SET data=? WHERE id=?", (json.dumps(rec), rec["id"]))


def append_event(run_id: str, event: dict[str, Any]) -> None:
    with _conn() as c:
        c.execute(
            "INSERT OR IGNORE INTO events (run_id, seq, data) VALUES (?,?,?)",
            (run_id, event["seq"], json.dumps(event)),
        )


def get_run(run_id: str) -> dict[str, Any] | None:
    with _conn() as c:
        row = c.execute("SELECT data FROM runs WHERE id=?", (run_id,)).fetchone()
    return json.loads(row["data"]) if row else None


def get_events(run_id: str, since: int = 0) -> list[dict[str, Any]]:
    with _conn() as c:
        rows = c.execute(
            "SELECT data FROM events WHERE run_id=? AND seq>=? ORDER BY seq", (run_id, since)
        ).fetchall()
    return [json.loads(r["data"]) for r in rows]


def list_runs(limit: int = 50) -> list[dict[str, Any]]:
    with _conn() as c:
        rows = c.execute(
            "SELECT data FROM runs ORDER BY started_at DESC LIMIT ?", (limit,)
        ).fetchall()
    return [json.loads(r["data"]) for r in rows]


# -- settings ----------------------------------------------------------------
def get_setting(key: str, default: Any = None) -> Any:
    with _conn() as c:
        row = c.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return json.loads(row["value"]) if row else default


def set_setting(key: str, value: Any) -> None:
    with _conn() as c:
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?,?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )
