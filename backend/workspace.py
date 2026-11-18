"""Demo sandboxes. Every browser gets its own ship: database, engine, clock and live hub.

A visitor is identified by a random workspace id that the frontend keeps in localStorage and
sends as `X-Workspace` (or `?ws=` for WebSockets). The id is the only key to that sandbox,
so ingest inside it needs no device token. Requests without an id use the default workspace,
which is the classic single-ship setup (device tokens, DATABASE_PATH).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import re
import time
from collections import OrderedDict
from pathlib import Path
from urllib.parse import parse_qs

from starlette.responses import JSONResponse

from access import load_limits, seed_accounts
from api.ingest import Gate
from api.live import Hub
from audit import load_key
from config_loader import data_dir, db_path, demo_mode, env_bool, env_float, load_yaml
from ctx import active_db, active_ws
from db import connect, run_writer, seed_devices
from earth_link import SimClock, delay_seconds
from scoring.clinical import Clinical
from scoring.engine import Engine
from sensors.eeg import BrainflowEEGDriver
from sensors.esp32 import Esp32Driver
from sensors.polar import PolarDriver
from sensors.push import PushDriver
from sensors.registry import resolve
from timesync import TimeSync

log = logging.getLogger("errno.workspace")

ID_RE = re.compile(r"^[A-Za-z0-9]{12,40}$")


class WorkspaceError(Exception):
    """The sandbox cannot be opened (server full)."""


class Workspace:
    """Everything the old single `app.state` held, for one visitor."""

    def __init__(self, ws_id: str | None, db_file: Path, *, default: bool) -> None:
        self.id = ws_id
        self.db_file = db_file
        self.is_default = default
        self.created = time.time()
        self.last_seen = self.created
        self.closed = False
        self.tasks: list[asyncio.Task] = []
        self.writer: asyncio.Task | None = None
        self.hub = Hub()

    def touch(self) -> None:
        self.last_seen = time.time()

    @classmethod
    async def open(cls, ws_id: str | None, db_file: Path, *, default: bool) -> "Workspace":
        self = cls(ws_id, db_file, default=default)
        db_file.parent.mkdir(parents=True, exist_ok=True)
        cx = await connect(db_file)
        if default:
            await seed_devices(cx, os.environ.get("DEVICE_TOKENS", ""))
        metrics = load_yaml("metrics.yaml")["metrics"]
        for metric in metrics:
            metric["_source"] = resolve(metric)
        engine = Engine({item["id"]: item for item in metrics}, load_yaml("scoring.yaml"), load_yaml("actions.yaml"))
        gate = Gate()
        await _hydrate(cx, engine, gate)
        crew = load_yaml("crew.yaml")["astronauts"]
        await seed_accounts(cx, [item["id"] for item in crew])

        self.cx = cx
        self.limits = await load_limits(cx)
        self.queue = asyncio.Queue()
        self.engine = engine
        self.gate = gate
        self.sync = TimeSync()
        self.metrics = metrics
        self.metrics_by_id = {item["id"]: item for item in metrics}
        self.crew = crew
        self.astronaut_ids = [item["id"] for item in crew]
        self.key = load_key()
        # A sandbox is private to its id, so it needs no device token. The default one keeps the old rules.
        self.no_auth = env_bool("DEV_NO_AUTH", False) if default else True
        self.demo = demo_mode()
        self.clock = SimClock()
        self.delay = delay_seconds()
        clinical = Clinical(metrics, self.astronaut_ids, load_yaml("penalty.yaml"), load_yaml("status.yaml"), self.delay)
        await clinical.hydrate(cx)
        self.clinical = clinical
        self.hub.clock = self.clock
        self.hub.delay = self.delay
        self.writer = asyncio.create_task(
            run_writer(
                self.queue,
                cx,
                engine,
                self.key,
                self.hub.publish,
                env_float("FLUSH_SECONDS", 0.25),
                gate.push_seen,
                clinical,
                self.clock,
            )
        )
        self.writer.add_done_callback(_writer_done)
        if default and env_bool("RUN_DRIVERS", True):
            self._start_drivers()
        return self

    def _start_drivers(self) -> None:
        metrics = self.metrics
        if any(item["_source"] == "polar" for item in metrics):
            self.tasks.append(asyncio.create_task(PolarDriver(metrics[0], "A1", self.queue).run()))
        if any(item["_source"] == "brainflow" for item in metrics):
            self.tasks.append(asyncio.create_task(BrainflowEEGDriver(metrics[0], "A1", self.queue).run()))
        esp = [item for item in metrics if item["_source"] == "esp32"]
        port = os.environ.get("ESP32_PORT", "")
        if esp and port:
            self.tasks.append(
                asyncio.create_task(Esp32Driver(esp[0], os.environ.get("ESP32_ASTRONAUT", "A1"), self.queue, port).run())
            )
        else:
            for metric in esp:
                for astronaut in self.astronaut_ids:
                    self.tasks.append(asyncio.create_task(PushDriver(metric, astronaut, self.queue, self.gate.push_seen).run()))

    async def close(self, *, delete: bool = False) -> None:
        if self.closed:
            return
        self.closed = True
        pending = [task for task in [self.writer, *self.tasks] if task is not None]
        for task in pending:
            task.cancel()
        for task in pending:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        for ws, _who, _user in list(self.hub.clients):
            with contextlib.suppress(Exception):
                await ws.close(code=4410)
        self.hub.clients = []
        with contextlib.suppress(Exception):
            await self.cx.close()
        if delete:
            for suffix in ("", "-wal", "-shm"):
                with contextlib.suppress(OSError):
                    Path(str(self.db_file) + suffix).unlink()


def _writer_done(task: asyncio.Task) -> None:
    if task.cancelled():
        return
    error = task.exception()
    if error is not None:
        log.error("writer stopped: %r", error)


async def _hydrate(cx, engine: Engine, gate: Gate) -> None:
    for row in await (await cx.execute("SELECT * FROM baselines")).fetchall():
        st = engine.state(row["astronaut_id"], row["sensor_id"])
        st.mean, st.var, st.n, st.updated = row["mean"], row["var"], row["n"], row["updated_ts"]
    for row in await (await cx.execute("SELECT * FROM alerts ORDER BY id")).fetchall():
        engine.alerts.append(
            {
                "id": row["id"],
                "ts": row["ts"],
                "astronaut_id": row["astronaut_id"],
                "sensor_id": row["sensor_id"],
                "category": row["category"],
                "level": row["level"],
                "message": row["message"],
                "explanation": row["explanation"],
                "acknowledged": row["acknowledged"],
                "open": not row["acknowledged"],
            }
        )
    if engine.alerts:
        engine._seq = max(item["id"] for item in engine.alerts)
    for row in await (await cx.execute("SELECT astronaut_id, help_needed FROM status ORDER BY ts")).fetchall():
        engine.help[row["astronaut_id"]] = bool(row["help_needed"])
    for row in await (await cx.execute("SELECT device_id, seq FROM ingest_seen")).fetchall():
        gate.seen.add((row["device_id"], row["seq"]))
    for row in await (await cx.execute("SELECT device_id, last_seq FROM device_state")).fetchall():
        if row["last_seq"] is not None:
            gate.last_seq[row["device_id"]] = row["last_seq"]


class Manager:
    """Owns the default workspace and the visitor sandboxes (LRU, idle expiry)."""

    def __init__(self) -> None:
        self.default: Workspace | None = None
        self.items: OrderedDict[str, Workspace] = OrderedDict()
        self._lock: asyncio.Lock | None = None
        self._last_sweep = 0.0

    @property
    def root(self) -> Path:
        return data_dir() / "workspaces"

    @property
    def limit(self) -> int:
        return max(1, int(env_float("MAX_WORKSPACES", 40)))

    @property
    def ttl(self) -> float:
        return env_float("WORKSPACE_TTL_SEC", 3 * 3600)

    async def start(self) -> Workspace:
        self._lock = asyncio.Lock()
        self.items.clear()
        self._purge_stale_files()
        self.default = await Workspace.open(None, db_path(), default=True)
        return self.default

    async def stop(self) -> None:
        for ws in list(self.items.values()):
            await ws.close()
        self.items.clear()
        if self.default is not None:
            await self.default.close()
            self.default = None

    def _purge_stale_files(self) -> None:
        """Delete sandbox files nobody touched for longer than the TTL (left by earlier runs)."""
        root = self.root
        if not root.exists():
            return
        cutoff = time.time() - self.ttl
        for path in root.glob("*.db*"):
            with contextlib.suppress(OSError):
                if path.stat().st_mtime < cutoff:
                    path.unlink()

    async def get(self, ws_id: str) -> Workspace:
        ws = self.items.get(ws_id)
        if ws is not None and not ws.closed:
            ws.touch()
            self.items.move_to_end(ws_id)
            await self._sweep()
            return ws
        assert self._lock is not None, "Manager.start() was not called"
        async with self._lock:
            ws = self.items.get(ws_id)
            if ws is not None and not ws.closed:
                ws.touch()
                return ws
            await self._make_room()
            ws = await Workspace.open(ws_id, self.root / f"{ws_id}.db", default=False)
            self.items[ws_id] = ws
            log.info("workspace %s opened (%d active)", ws_id[:6], len(self.items))
            return ws

    async def reset(self, ws_id: str) -> Workspace:
        assert self._lock is not None
        async with self._lock:
            old = self.items.pop(ws_id, None)
            if old is not None:
                await old.close(delete=True)
            ws = await Workspace.open(ws_id, self.root / f"{ws_id}.db", default=False)
            self.items[ws_id] = ws
            return ws

    async def _sweep(self) -> None:
        moment = time.time()
        if moment - self._last_sweep < 60:
            return
        self._last_sweep = moment
        for key, ws in list(self.items.items()):
            if moment - ws.last_seen > self.ttl and not ws.hub.clients:
                self.items.pop(key, None)
                await ws.close(delete=True)
                log.info("workspace %s expired", key[:6])

    async def _make_room(self) -> None:
        while len(self.items) >= self.limit:
            victim = next((key for key, ws in self.items.items() if not ws.hub.clients), None)
            if victim is None:
                raise WorkspaceError("all demo workspaces are busy")
            ws = self.items.pop(victim)
            await ws.close(delete=True)
            log.info("workspace %s evicted (limit %d)", victim[:6], self.limit)


manager = Manager()


class StateProxy:
    """Stands in for `app.state`: every attribute comes from the workspace that owns the request."""

    def _ws(self) -> Workspace:
        ws = active_ws.get() or manager.default
        if ws is None:
            raise AttributeError("no workspace is open yet")
        return ws  # type: ignore[return-value]

    def __getattr__(self, name: str):
        return getattr(self._ws(), name)

    def __setattr__(self, name: str, value) -> None:
        setattr(self._ws(), name, value)


def _pick_id(scope) -> str | None:
    for key, value in scope.get("headers") or []:
        if key == b"x-workspace":
            return value.decode("latin-1").strip() or None
    query = parse_qs((scope.get("query_string") or b"").decode("latin-1"))
    values = query.get("ws")
    return values[0].strip() if values and values[0].strip() else None


class WorkspaceMiddleware:
    """Pure ASGI, so the contextvars are visible to HTTP handlers and WebSocket handlers alike."""

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send) -> None:
        if scope["type"] not in {"http", "websocket"}:
            await self.app(scope, receive, send)
            return
        ws_id = _pick_id(scope)
        ws: Workspace | None = manager.default
        if ws_id is not None:
            if not ID_RE.match(ws_id):
                await _refuse(scope, receive, send, 400, "Invalid workspace id", 4400)
                return
            try:
                ws = await manager.get(ws_id)
            except WorkspaceError:
                await _refuse(scope, receive, send, 503, "Demo is full, try again in a few minutes", 4503)
                return
        elif ws is not None:
            ws.touch()
        token_ws = active_ws.set(ws)
        token_db = active_db.set(ws.db_file if ws is not None else None)
        try:
            await self.app(scope, receive, send)
        finally:
            active_ws.reset(token_ws)
            active_db.reset(token_db)


async def _refuse(scope, receive, send, status: int, detail: str, ws_code: int) -> None:
    if scope["type"] == "websocket":
        await receive()
        await send({"type": "websocket.close", "code": ws_code})
        return
    await JSONResponse({"detail": detail}, status_code=status)(scope, receive, send)
