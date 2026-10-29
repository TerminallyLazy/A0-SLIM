"""Durable intent, process exclusion and conservative crash recovery."""
import fcntl
import json
import os
import sqlite3
from contextlib import contextmanager
from pathlib import Path


class Journal:
    def __init__(self, directory: Path):
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.directory = directory
        self.db = sqlite3.connect(directory / "operations.db", isolation_level=None)
        os.chmod(directory / "operations.db", 0o600)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, digest TEXT NOT NULL, status TEXT NOT NULL, result TEXT, resolution TEXT)")

    @contextmanager
    def exclusive(self):
        with open(self.directory / "operation.lock", "a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError("Another operation is active in this project/profile") from None
            try:
                # Only the exclusive owner can conclude a previous writer died.
                self.db.execute("UPDATE operations SET status='unknown' WHERE status='running'")
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def inspect(self, operation_id):
        row = self.db.execute("SELECT id,digest,status,result,resolution FROM operations WHERE id=?", (operation_id,)).fetchone()
        return dict(zip(("id", "digest", "status", "result", "resolution"), row)) if row else None

    def begin(self, operation_id, digest):
        old = self.inspect(operation_id)
        if old:
            if old["digest"] != digest:
                raise RuntimeError("Operation ID already belongs to different arguments or revision")
            if old["status"] == "completed":
                return json.loads(old["result"])
            raise RuntimeError("Existing operation is unresolved or already closed; it will not be replayed")
        if self.db.execute("SELECT 1 FROM operations WHERE status IN ('running','unknown') LIMIT 1").fetchone():
            raise RuntimeError("Review the unknown operation before starting more work")
        self.db.execute("INSERT INTO operations(id,digest,status) VALUES(?,?,'running')", (operation_id, digest))
        return None

    def complete(self, operation_id, result):
        self.db.execute("UPDATE operations SET status='completed',result=? WHERE id=? AND status='running'", (json.dumps(result), operation_id))

    def unknown(self, operation_id):
        self.db.execute("UPDATE operations SET status='unknown' WHERE id=? AND status='running'", (operation_id,))

    def resolve(self, operation_id, reason):
        if len(reason.strip()) < 10:
            raise ValueError("Record how the external outcome was checked")
        with self.exclusive():
            if not self.db.execute("UPDATE operations SET status='resolved',resolution=? WHERE id=? AND status='unknown'", (reason, operation_id)).rowcount:
                raise ValueError("Only an unknown operation can be resolved")
