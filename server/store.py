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
