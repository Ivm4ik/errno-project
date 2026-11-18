import hashlib
import json
from pathlib import Path

import aiosqlite

from audit import GENESIS, link, load_key, sign
from config_loader import db_path
from ctx import active_db

SCHEMA = """
CREATE TABLE IF NOT EXISTS readings(
  id INTEGER PRIMARY KEY,
  ts REAL, astronaut_id TEXT, sensor_id TEXT, value REAL, unit TEXT,
  quality REAL, source TEXT, device_id TEXT, activity_mode TEXT
);
CREATE INDEX IF NOT EXISTS idx_readings ON readings(astronaut_id, sensor_id, ts);
CREATE TABLE IF NOT EXISTS rollups_1m(
  ts REAL, astronaut_id TEXT, sensor_id TEXT, avg REAL, min REAL, max REAL, n INTEGER,
  PRIMARY KEY(ts, astronaut_id, sensor_id)
);
CREATE TABLE IF NOT EXISTS baselines(
  astronaut_id TEXT, sensor_id TEXT, mean REAL, var REAL, n INTEGER, updated_ts REAL,
  PRIMARY KEY(astronaut_id, sensor_id)
);
CREATE TABLE IF NOT EXISTS alerts(
  id INTEGER PRIMARY KEY,
  ts REAL, astronaut_id TEXT, sensor_id TEXT, category TEXT, level TEXT,
  message TEXT, explanation TEXT, acknowledged INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS status(
  ts REAL, astronaut_id TEXT, score REAL, level TEXT, help_needed INTEGER
);
CREATE TABLE IF NOT EXISTS actions(
  id INTEGER PRIMARY KEY,
  ts REAL, astronaut_id TEXT, alert_id INTEGER, action TEXT
);
CREATE TABLE IF NOT EXISTS audit_log(
  id INTEGER PRIMARY KEY,
  ts REAL, kind TEXT, payload TEXT, prev_hash TEXT, hash TEXT, sig TEXT
);
CREATE TABLE IF NOT EXISTS devices(
  device_id TEXT PRIMARY KEY,
  token TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_state(
  device_id TEXT PRIMARY KEY,
  last_seq INTEGER,
  lost_packets INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS ingest_seen(
  device_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY(device_id, seq)
);
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL,
  name TEXT NOT NULL,
  astronaut_id TEXT
);
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS limits(
  astronaut_id TEXT NOT NULL,
  sensor_id TEXT NOT NULL,
  min_value REAL,
  max_value REAL,
  PRIMARY KEY(astronaut_id, sensor_id)
);
CREATE TABLE IF NOT EXISTS changes(
  id INTEGER PRIMARY KEY,
  rev INTEGER,
  ts REAL NOT NULL,
  actor_id INTEGER NOT NULL,
  actor_login TEXT NOT NULL,
  role TEXT NOT NULL,
  astronaut_id TEXT,
  sensor_id TEXT,
  field TEXT NOT NULL,
  old_value REAL,
  new_value REAL,
  note TEXT
);
CREATE TABLE IF NOT EXISTS status_state(
  astronaut_id TEXT PRIMARY KEY,
  status INTEGER NOT NULL DEFAULT 0,
  health_index REAL,
  total REAL,
  max_penalty REAL,
  notice_count INTEGER NOT NULL DEFAULT 0,
  reset_hold INTEGER NOT NULL DEFAULT 0,
  clear_hold INTEGER NOT NULL DEFAULT 0,
  last_eval_ts REAL,
  activity_mode TEXT,
  notices_json TEXT,
  break_glass INTEGER NOT NULL DEFAULT 0,
  incident_id INTEGER
);
CREATE TABLE IF NOT EXISTS status_history(
  id INTEGER PRIMARY KEY,
  ts REAL, astronaut_id TEXT, status INTEGER, from_status INTEGER,
  health_index REAL, total REAL, reason TEXT
);
CREATE TABLE IF NOT EXISTS penalty_log(
  id INTEGER PRIMARY KEY,
  ts REAL NOT NULL, astronaut_id TEXT NOT NULL,
  health_index REAL, total REAL, status INTEGER, breakdown TEXT
);
CREATE TABLE IF NOT EXISTS incidents(
  id INTEGER PRIMARY KEY,
  astronaut_id TEXT, opened_at REAL, closed_at REAL,
  break_glass INTEGER NOT NULL DEFAULT 1, trigger_json TEXT
);
CREATE TABLE IF NOT EXISTS incident_steps(
  id INTEGER PRIMARY KEY,
  incident_id INTEGER, ts REAL, actor_login TEXT, text TEXT, done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS breakglass_access_log(
  id INTEGER PRIMARY KEY,
  ts REAL, actor_login TEXT, astronaut_id TEXT, incident_id INTEGER
);
CREATE TABLE IF NOT EXISTS earth_packets(
  id INTEGER PRIMARY KEY,
  astronaut_id TEXT, created_at REAL, visible_at REAL, payload TEXT, incident_id INTEGER
);
CREATE TABLE IF NOT EXISTS earth_queue(
  id INTEGER PRIMARY KEY,
  direction TEXT, kind TEXT, payload TEXT, created_at REAL, arrives_at REAL,
  delivered INTEGER NOT NULL DEFAULT 0
);
"""


_READY: set[str] = set()


async def connect(path=None) -> aiosqlite.Connection:
    """Open the database of the current sandbox (see ctx.active_db), or an explicit file."""
    target = path or active_db.get() or db_path()
    key = str(target)
    # Schema and migrations are write transactions. Run them once per file, not on every request,
    # or readers fight the writer for the lock. A deleted file (sandbox reset) is set up again.
    ready = key in _READY and Path(key).exists()
    cx = await aiosqlite.connect(target)
    cx.row_factory = aiosqlite.Row
    await cx.execute("PRAGMA busy_timeout=5000")
    await cx.execute("PRAGMA synchronous=NORMAL")
    if not ready:
        await (await cx.execute("PRAGMA journal_mode=WAL")).fetchone()
        await cx.executescript(SCHEMA)
        await _migrate(cx)
        await cx.commit()
        _READY.add(key)
    return cx


async def _migrate(cx: aiosqlite.Connection) -> None:
    cols = {row[1] for row in await (await cx.execute("PRAGMA table_info(changes)")).fetchall()}
    if "rev" not in cols:
        await cx.execute("ALTER TABLE changes ADD COLUMN rev INTEGER")
    if "note" not in cols:
        await cx.execute("ALTER TABLE changes ADD COLUMN note TEXT")
    await cx.execute("UPDATE changes SET rev=id WHERE rev IS NULL")
    reading_cols = {row[1] for row in await (await cx.execute("PRAGMA table_info(readings)")).fetchall()}
    if "activity_mode" not in reading_cols:
        await cx.execute("ALTER TABLE readings ADD COLUMN activity_mode TEXT")


async def seed_devices(cx: aiosqlite.Connection, tokens: str) -> None:
    for piece in tokens.split(","):
        if ":" not in piece:
            continue
        device_id, token = piece.split(":", 1)
        device_id, token = device_id.strip(), token.strip()
        if device_id and token:
            await cx.execute(
                "INSERT INTO devices(device_id, token) VALUES(?, ?) ON CONFLICT(device_id) DO UPDATE SET token=excluded.token",
                (device_id, token),
            )
    await cx.commit()


async def last_hash(cx: aiosqlite.Connection) -> str:
    row = await (await cx.execute("SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1")).fetchone()
    return row["hash"] if row else GENESIS


async def append_audit(cx: aiosqlite.Connection, key, ts: float, kind: str, payload) -> None:
    prev = await last_hash(cx)
    digest, _ = link(prev, ts, kind, payload)
    await cx.execute(
        "INSERT INTO audit_log(ts, kind, payload, prev_hash, hash, sig) VALUES(?, ?, ?, ?, ?, ?)",
        (ts, kind, json.dumps(payload, ensure_ascii=False, sort_keys=True), prev, digest, sign(key, digest)),
    )


def checkpoint_payload(rows: list[tuple]) -> str:
    blob = json.dumps(rows, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(blob.encode()).hexdigest()


async def run_writer(queue, cx, engine, key, publish, flush_s: float, push_seen: dict, clinical=None, clock=None) -> None:
    import asyncio

    batch: list = []
    last_minute: int | None = None
    while True:
        try:
            item = await asyncio.wait_for(queue.get(), timeout=flush_s)
            batch.append(item)
            if len(batch) >= 200:
                last_minute = await _flush(cx, engine, key, publish, batch, last_minute, push_seen, clinical, clock)
                batch = []
        except TimeoutError:
            if batch:
                last_minute = await _flush(cx, engine, key, publish, batch, last_minute, push_seen, clinical, clock)
                batch = []


async def _flush(cx, engine, key, publish, batch: list, last_minute: int | None, push_seen: dict, clinical=None, clock=None) -> int | None:
    events: list[dict] = []
    rows = []
    for item in batch:
        if isinstance(item, tuple) and item and item[0] == "seen":
            _, device_id, seq, lost = item
            await cx.execute(
                "INSERT OR IGNORE INTO ingest_seen(device_id, seq) VALUES(?, ?)",
                (device_id, seq),
            )
            await cx.execute(
                """INSERT INTO device_state(device_id, last_seq, lost_packets) VALUES(?, ?, ?)
                   ON CONFLICT(device_id) DO UPDATE SET
                     last_seq=excluded.last_seq,
                     lost_packets=device_state.lost_packets + ?""",
                (device_id, seq, lost, lost),
            )
            continue
        if isinstance(item, tuple) and item and item[0] == "silence":
            _, astronaut, sensor, last_good, ts = item
            events.extend(engine.mark_silent(astronaut, sensor, last_good, ts))
            continue
        events.extend(engine.step(item))
        if item.source != "sim":
            push_seen[(item.astronaut_id, item.sensor_id)] = item.ts
        rows.append(
            (
                item.ts,
                item.astronaut_id,
                item.sensor_id,
                item.value,
                item.unit,
                item.quality,
                item.source,
                item.device_id,
                getattr(item, "activity_mode", None) or "rest",
            )
        )
    if rows:
        await cx.executemany(
            "INSERT INTO readings(ts, astronaut_id, sensor_id, value, unit, quality, source, device_id, activity_mode) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rows,
        )
    for event in events:
        if event["type"] != "alert":
            continue
        alert = event["data"]
        cur = await cx.execute(
            """INSERT INTO alerts(ts, astronaut_id, sensor_id, category, level, message, explanation, acknowledged)
               VALUES(?, ?, ?, ?, ?, ?, ?, 0)""",
            (
                alert["ts"],
                alert["astronaut_id"],
                alert["sensor_id"],
                alert["category"],
                alert["level"],
                alert["message"],
                alert["explanation"],
            ),
        )
        alert["id"] = cur.lastrowid
        await append_audit(cx, key, alert["ts"], "alert", {"id": alert["id"], "sensor_id": alert["sensor_id"], "level": alert["level"]})
    events = [event for event in events if event["type"] != "status"]
    sim_now = clock.now if clock is not None else 0.0
    if clinical is not None:
        from earth_link import deliver_due

        for item in batch:
            if isinstance(item, tuple):
                continue
            if clock is not None:
                clock.observe(item.ts)
            clinical.observe(item)
        sim_now = clock.now if clock is not None else sim_now
        await deliver_due(cx, sim_now)
        events.extend(await clinical.catch_up(cx, key, sim_now))
    for (astronaut, sensor), st in engine.states.items():
        if st.n <= 0:
            continue
        await cx.execute(
            """INSERT INTO baselines(astronaut_id, sensor_id, mean, var, n, updated_ts) VALUES(?, ?, ?, ?, ?, ?)
               ON CONFLICT(astronaut_id, sensor_id) DO UPDATE SET
                 mean=excluded.mean, var=excluded.var, n=excluded.n, updated_ts=excluded.updated_ts""",
            (astronaut, sensor, st.mean, st.var, st.n, st.updated),
        )
    minute = None
    if rows:
        newest = max(row[0] for row in rows)
        minute = int(newest // 60)
        start = minute * 60
        await cx.execute(
            """INSERT INTO rollups_1m(ts, astronaut_id, sensor_id, avg, min, max, n)
               SELECT ?, astronaut_id, sensor_id, AVG(value), MIN(value), MAX(value), COUNT(*)
               FROM readings WHERE ts >= ? AND ts < ?
               GROUP BY astronaut_id, sensor_id
               ON CONFLICT(ts, astronaut_id, sensor_id) DO UPDATE SET
                 avg=excluded.avg, min=excluded.min, max=excluded.max, n=excluded.n""",
            (start, start, start + 60),
        )
        await cx.execute("DELETE FROM readings WHERE ts < ?", (newest - 86400,))
        if last_minute is not None and minute != last_minute:
            packed = [(row[0], row[1], row[2], row[3]) for row in rows]
            await append_audit(cx, key, newest, "checkpoint", {"minute": minute, "sha256": checkpoint_payload(packed)})
    await cx.commit()
    # Push live readings over /live WebSocket so the panel does not poll forever.
    # ECG is high-rate: one batched ecg_chunk per astronaut (ICU-style), not 100 WS msgs/s.
    ecg_chunks: dict[str, list[dict]] = {}
    for row in rows:
        if row[2] == "ecg":
            ecg_chunks.setdefault(row[1], []).append({"ts": float(row[0]), "v": float(row[3])})
            continue
        events.append(
            {
                "type": "reading",
                "ts": row[0],
                "data": {
                    "ts": row[0],
                    "astronaut_id": row[1],
                    "sensor_id": row[2],
                    "value": row[3],
                    "unit": row[4],
                    "quality": row[5],
                    "source": row[6],
                    "device_id": row[7],
                    "activity_mode": row[8] if len(row) > 8 else "rest",
                },
            }
        )
    for aid, samples in ecg_chunks.items():
        events.append(
            {
                "type": "ecg_chunk",
                "ts": samples[-1]["ts"],
                "data": {
                    "astronaut_id": aid,
                    "sensor_id": "ecg",
                    "unit": "mV",
                    "samples": samples,
                },
            }
        )
    for event in events:
        await publish(event)
    return minute if minute is not None else last_minute


def alert_ts(events: list[dict]) -> float:
    for event in events:
        if event["type"] == "alert":
            return float(event["data"]["ts"])
    return 0.0
