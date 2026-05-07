"""
Run history — stores ZERO personal data.

What IS stored (anonymous):
  - run_id (UUID)
  - created_at (timestamp)
  - naming convention used
  - prefix used
  - count of PDFs generated
  - count of errors

What is NEVER stored:
  - Student names
  - Student numbers
  - Institutions
  - PDF content
  - ZIP files
  - Any personal identifiers

Auto-deletion: records older than 90 days are purged automatically.
"""

import os, json, sqlite3
from datetime import datetime, timezone, timedelta
from typing import Optional

USE_FIRESTORE = bool(os.environ.get("GOOGLE_CLOUD_PROJECT"))
RETENTION_DAYS = 90

if USE_FIRESTORE:
    from google.cloud import firestore
    _db = firestore.AsyncClient()


class FirestoreStore:
    _COL = "runs"

    async def list_runs(self):
        await self._purge_old()
        runs = []
        async for doc in _db.collection(self._COL)\
                .order_by("created_at", direction=firestore.Query.DESCENDING)\
                .stream():
            runs.append(doc.to_dict())
        return runs

    async def save_run(self, run_id: str, meta: dict):
        # meta is already personal-data-free — enforced by caller
        await _db.collection(self._COL).document(run_id).set(meta)

    async def delete_run(self, run_id: str):
        await _db.collection(self._COL).document(run_id).delete()

    async def _purge_old(self):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
        async for doc in _db.collection(self._COL)\
                .where("created_at", "<", cutoff).stream():
            await doc.reference.delete()


class SQLiteStore:
    _PATH = os.environ.get("SQLITE_PATH", "/tmp/bundler_runs.db")

    def __init__(self):
        with self._conn() as c:
            c.execute("""
                CREATE TABLE IF NOT EXISTS runs (
                    run_id     TEXT PRIMARY KEY,
                    created_at TEXT NOT NULL,
                    meta       TEXT NOT NULL
                    -- No zip_data column — ZIPs never stored
                )
            """)

    def _conn(self):
        return sqlite3.connect(self._PATH)

    async def list_runs(self):
        self._purge_old()
        with self._conn() as c:
            rows = c.execute(
                "SELECT meta FROM runs ORDER BY created_at DESC"
            ).fetchall()
        return [json.loads(r[0]) for r in rows]

    async def save_run(self, run_id: str, meta: dict):
        with self._conn() as c:
            c.execute(
                "INSERT OR REPLACE INTO runs VALUES (?,?,?)",
                (run_id, meta.get("created_at",""), json.dumps(meta))
            )

    async def delete_run(self, run_id: str):
        with self._conn() as c:
            c.execute("DELETE FROM runs WHERE run_id=?", (run_id,))

    def _purge_old(self):
        cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).isoformat()
        with self._conn() as c:
            c.execute("DELETE FROM runs WHERE created_at < ?", (cutoff,))


def RunStore():
    return FirestoreStore() if USE_FIRESTORE else SQLiteStore()
