"""
SQLite database module for Stream Labs Quotation Tool.
Stores quotation snapshots by deal_id + version.
"""

import sqlite3
import json
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "data", "quotations.db")


def _connect():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    """Create tables if they don't exist."""
    with _connect() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS quotations (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                deal_id     TEXT    NOT NULL,
                version     TEXT    NOT NULL DEFAULT 'V1',
                company     TEXT    NOT NULL DEFAULT '',
                contact     TEXT    NOT NULL DEFAULT '',
                country     TEXT    NOT NULL DEFAULT '',
                summary     TEXT    NOT NULL DEFAULT '',
                created_by  TEXT    NOT NULL DEFAULT '',
                data        TEXT    NOT NULL,   -- full JSON snapshot
                created_at  TEXT    NOT NULL,
                updated_at  TEXT    NOT NULL,
                UNIQUE(deal_id, version)
            )
        """)
        conn.execute("""
            CREATE INDEX IF NOT EXISTS idx_deal_id ON quotations(deal_id)
        """)
        # Migration for DBs created before created_by existed
        cols = [r["name"] for r in conn.execute("PRAGMA table_info(quotations)").fetchall()]
        if "created_by" not in cols:
            conn.execute("ALTER TABLE quotations ADD COLUMN created_by TEXT NOT NULL DEFAULT ''")
    return True


def save_quotation(deal_id: str, version: str, data: dict, overwrite: bool = False, created_by: str = "") -> dict:
    """
    Save or update a quotation snapshot.
    Returns {"ok": True, "id": ..., "created": bool}
    or {"ok": False, "conflict": True} if version exists and overwrite=False.
    """
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")
    company = data.get("company", "")
    contact = data.get("contact", "")
    country = data.get("country", "")
    summary = data.get("summary", "")
    data_json = json.dumps(data, ensure_ascii=False)

    with _connect() as conn:
        existing = conn.execute(
            "SELECT id, created_at, created_by FROM quotations WHERE deal_id=? AND version=?",
            (deal_id, version)
        ).fetchone()

        if existing:
            if not overwrite:
                return {"ok": False, "conflict": True, "existing_id": existing["id"]}
            conn.execute("""
                UPDATE quotations
                SET company=?, contact=?, country=?, summary=?, data=?, updated_at=?
                WHERE deal_id=? AND version=?
            """, (company, contact, country, summary, data_json, now, deal_id, version))
            return {"ok": True, "id": existing["id"], "created": False}
        else:
            cur = conn.execute("""
                INSERT INTO quotations (deal_id, version, company, contact, country, summary, created_by, data, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (deal_id, version, company, contact, country, summary, created_by, data_json, now, now))
            return {"ok": True, "id": cur.lastrowid, "created": True}


def get_quotation(deal_id: str, version: str) -> dict | None:
    """Load a specific version of a quotation."""
    with _connect() as conn:
        row = conn.execute(
            "SELECT * FROM quotations WHERE deal_id=? AND version=?",
            (deal_id, version)
        ).fetchone()
        if not row:
            return None
        result = dict(row)
        result["data"] = json.loads(result["data"])
        return result


def list_versions(deal_id: str) -> list:
    """List all saved versions for a deal_id."""
    with _connect() as conn:
        rows = conn.execute("""
            SELECT id, deal_id, version, company, contact, country, created_by, updated_at
            FROM quotations WHERE deal_id=?
            ORDER BY version ASC
        """, (deal_id,)).fetchall()
        return [dict(r) for r in rows]


def list_all(limit: int = 100, offset: int = 0, search: str = "", created_by: str = "") -> dict:
    """List all quotations with optional search by company/deal_id and optional creator filter."""
    with _connect() as conn:
        where  = []
        params = []
        if search:
            like = f"%{search}%"
            where.append("(company LIKE ? OR deal_id LIKE ? OR contact LIKE ?)")
            params += [like, like, like]
        if created_by:
            where.append("created_by = ?")
            params.append(created_by)
        clause = f"WHERE {' AND '.join(where)}" if where else ""

        rows = conn.execute(f"""
            SELECT id, deal_id, version, company, contact, country, created_by, updated_at
            FROM quotations {clause}
            ORDER BY updated_at DESC LIMIT ? OFFSET ?
        """, (*params, limit, offset)).fetchall()
        total = conn.execute(f"SELECT COUNT(*) FROM quotations {clause}", params).fetchone()[0]
        return {"items": [dict(r) for r in rows], "total": total}


def delete_quotation(deal_id: str, version: str) -> bool:
    """Delete a specific version."""
    with _connect() as conn:
        cur = conn.execute(
            "DELETE FROM quotations WHERE deal_id=? AND version=?",
            (deal_id, version)
        )
        return cur.rowcount > 0


# Auto-initialize on import
init_db()
