#!/usr/bin/env python3
"""
M5 collab smoke: N concurrent "clients" on one SQLite oko.db (simulates SMB share).

Does not launch the GUI. Exercises the same tables Tauri M2 uses:
  cell_presence claim/heartbeat, form_cell_values upserts under WAL.

Usage:
  python3 scripts/tauri-collab-smoke.py /path/to/package-folder [--clients 10] [--seconds 20]

Package folder must contain oko.db (WAL recommended). Creates cell_presence if missing.
Exit 0 if all clients completed without unrecoverable errors and busy rate is acceptable.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def migrate(conn: sqlite3.Connection) -> None:
    conn.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA busy_timeout = 5000;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS cell_presence (
          instance_id TEXT NOT NULL,
          row_no INTEGER NOT NULL,
          column_key TEXT NOT NULL,
          user_name TEXT NOT NULL,
          machine_name TEXT,
          client_id TEXT NOT NULL,
          heartbeat_at TEXT NOT NULL,
          PRIMARY KEY (instance_id, row_no, column_key)
        );
        """
    )
    cols = {r[1] for r in conn.execute("PRAGMA table_info(form_cell_values)")}
    for col, ddl in (
        ("updated_at", "ALTER TABLE form_cell_values ADD COLUMN updated_at TEXT"),
        ("updated_by", "ALTER TABLE form_cell_values ADD COLUMN updated_by TEXT"),
        ("updated_client_id", "ALTER TABLE form_cell_values ADD COLUMN updated_client_id TEXT"),
    ):
        if col not in cols:
            try:
                conn.execute(ddl)
            except sqlite3.OperationalError:
                pass
    conn.commit()


def pick_instance(conn: sqlite3.Connection) -> str | None:
    row = conn.execute(
        "SELECT instance_id FROM form_instances ORDER BY template_id LIMIT 1"
    ).fetchone()
    return row[0] if row else None


class Stats:
    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.ok = 0
        self.busy = 0
        self.errors: list[str] = []
        self.claims = 0
        self.writes = 0

    def add_ok(self) -> None:
        with self.lock:
            self.ok += 1

    def add_busy(self) -> None:
        with self.lock:
            self.busy += 1

    def add_err(self, msg: str) -> None:
        with self.lock:
            self.errors.append(msg)

    def add_claim(self) -> None:
        with self.lock:
            self.claims += 1

    def add_write(self) -> None:
        with self.lock:
            self.writes += 1


def client_loop(
    db_path: Path,
    instance_id: str,
    client_idx: int,
    duration_sec: float,
    stats: Stats,
) -> None:
    client_id = str(uuid.uuid4())
    user = f"smoke-{client_idx}"
    # Distinct cells per client to match TZ acceptance (different cells)
    row_no = 900_000_000 + client_idx
    column_key = "C"
    deadline = time.time() + duration_sec

    while time.time() < deadline:
        try:
            conn = sqlite3.connect(str(db_path), timeout=5.0, isolation_level=None)
            conn.execute("PRAGMA busy_timeout = 5000")
            now = iso_now()
            cutoff = datetime.now(timezone.utc).timestamp() - 30
            cutoff_iso = datetime.fromtimestamp(cutoff, timezone.utc).isoformat().replace(
                "+00:00", "Z"
            )

            conn.execute("BEGIN IMMEDIATE")
            conn.execute("DELETE FROM cell_presence WHERE client_id = ?", (client_id,))
            occupied = conn.execute(
                """
                SELECT user_name FROM cell_presence
                WHERE instance_id=? AND row_no=? AND column_key=?
                  AND client_id!=? AND heartbeat_at>=?
                """,
                (instance_id, row_no, column_key, client_id, cutoff_iso),
            ).fetchone()
            if occupied:
                conn.execute("COMMIT")
                stats.add_busy()
            else:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO cell_presence
                      (instance_id, row_no, column_key, user_name, machine_name, client_id, heartbeat_at)
                    VALUES (?,?,?,?,?,?,?)
                    """,
                    (instance_id, row_no, column_key, user, "smoke", client_id, now),
                )
                stats.add_claim()
                value = float(client_idx) + (time.time() % 1)
                conn.execute(
                    """
                    INSERT INTO form_cell_values (
                      instance_id, row_no, row_name, column_key, value_num, value_text,
                      updated_at, updated_by, updated_client_id
                    ) VALUES (?,?,NULL,?,?,NULL,?,?,?)
                    ON CONFLICT(instance_id, row_no, column_key) DO UPDATE SET
                      value_num=excluded.value_num,
                      updated_at=excluded.updated_at,
                      updated_by=excluded.updated_by,
                      updated_client_id=excluded.updated_client_id
                    """,
                    (instance_id, row_no, column_key, value, now, user, client_id),
                )
                conn.execute(
                    "UPDATE form_instances SET updated_at=? WHERE instance_id=?",
                    (now, instance_id),
                )
                conn.execute("COMMIT")
                stats.add_write()
                stats.add_ok()
            conn.execute(
                "UPDATE cell_presence SET heartbeat_at=? WHERE client_id=?",
                (iso_now(), client_id),
            )
            conn.close()
        except sqlite3.OperationalError as e:
            msg = str(e).lower()
            if "locked" in msg or "busy" in msg:
                stats.add_busy()
            else:
                stats.add_err(f"{user}: {e}")
        except Exception as e:  # noqa: BLE001
            stats.add_err(f"{user}: {e}")
        time.sleep(0.15)

    # release
    try:
        conn = sqlite3.connect(str(db_path), timeout=5.0)
        conn.execute("DELETE FROM cell_presence WHERE client_id = ?", (client_id,))
        conn.commit()
        conn.close()
    except Exception:
        pass


def conflict_claim_test(db_path: Path, instance_id: str) -> None:
    """§15.2: second claim on same cell must fail while first holds it."""
    a = str(uuid.uuid4())
    b = str(uuid.uuid4())
    now = iso_now()
    with sqlite3.connect(str(db_path), timeout=10.0) as conn:
        migrate(conn)
        conn.execute("DELETE FROM cell_presence WHERE instance_id = ?", (instance_id,))
        conn.execute(
            """INSERT INTO cell_presence
               (instance_id, row_no, column_key, user_name, machine_name, client_id, heartbeat_at)
               VALUES (?,?,?,?,?,?,?)""",
            (instance_id, 1, "colA", "user-a", "pc-a", a, now),
        )
        conn.commit()
        occupied = conn.execute(
            """SELECT user_name FROM cell_presence
               WHERE instance_id=? AND row_no=? AND column_key=?
                 AND client_id != ?""",
            (instance_id, 1, "colA", b),
        ).fetchone()
        if not occupied:
            raise AssertionError("conflict-test: expected occupied cell")
        # row-star lock: presence on * blocks any column
        conn.execute(
            """INSERT OR REPLACE INTO cell_presence
               (instance_id, row_no, column_key, user_name, machine_name, client_id, heartbeat_at)
               VALUES (?,?,?,?,?,?,?)""",
            (instance_id, 2, "*", "user-a", "pc-a", a, now),
        )
        conn.commit()
        star = conn.execute(
            """SELECT user_name FROM cell_presence
               WHERE instance_id=? AND row_no=? AND client_id != ?
                 AND (column_key = ? OR column_key = '*')""",
            (instance_id, 2, b, "colB"),
        ).fetchone()
        if not star:
            raise AssertionError("conflict-test: expected * row lock")
        conn.execute("DELETE FROM cell_presence WHERE client_id = ?", (a,))
        conn.commit()
    print("conflict-test: PASS (cell + row-* lock)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("package_folder", type=Path, help="Folder with oko.db")
    ap.add_argument("--clients", type=int, default=10, help="Concurrent clients (default 10)")
    ap.add_argument("--seconds", type=float, default=15, help="Run duration seconds")
    ap.add_argument(
        "--conflict-test",
        action="store_true",
        help="Assert same-cell and row-* claim exclusion (§15.2 / §6.4)",
    )
    args = ap.parse_args()

    folder: Path = args.package_folder
    db_path = folder / "oko.db"
    if not db_path.is_file():
        print(f"ERROR: no oko.db in {folder}", file=sys.stderr)
        return 2

    with sqlite3.connect(str(db_path), timeout=10.0) as conn:
        migrate(conn)
        instance_id = pick_instance(conn)
    if not instance_id:
        print("ERROR: form_instances is empty — open/seed a package first", file=sys.stderr)
        return 2

    if args.conflict_test:
        try:
            conflict_claim_test(db_path, instance_id)
        except Exception as e:  # noqa: BLE001
            print(f"ERROR: conflict-test failed: {e}", file=sys.stderr)
            return 1

    print(
        f"collab smoke: db={db_path} instance={instance_id} "
        f"clients={args.clients} seconds={args.seconds}"
    )
    stats = Stats()
    threads = [
        threading.Thread(
            target=client_loop,
            args=(db_path, instance_id, i, args.seconds, stats),
            daemon=True,
        )
        for i in range(args.clients)
    ]
    t0 = time.time()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    elapsed = time.time() - t0

    print(
        f"done in {elapsed:.1f}s: ok={stats.ok} writes={stats.writes} "
        f"claims={stats.claims} busy={stats.busy} errors={len(stats.errors)}"
    )
    for e in stats.errors[:10]:
        print(f"  ERR {e}", file=sys.stderr)

    # Acceptable: some BUSY under contention; fail on hard errors or zero writes
    if stats.errors:
        return 1
    if stats.writes < args.clients:
        print("ERROR: too few successful writes", file=sys.stderr)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
