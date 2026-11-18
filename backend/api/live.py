import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()


class Hub:
    """Live push channel of one sandbox. Every workspace owns its own hub."""

    def __init__(self) -> None:
        # (ws, astronaut filter | None, user dict)
        self.clients: list[tuple] = []
        self._last: dict[tuple[str, str], float] = {}
        self.clock = None
        self.delay = 0.0
        # Min gap between reading pushes per (astronaut, sensor). Snappy for demos.
        self.reading_gap = 0.2

    async def connect(self, ws: WebSocket, astronaut_id: str | None, user: dict) -> None:
        await ws.accept()
        self.clients.append((ws, astronaut_id, user))

    def drop(self, ws: WebSocket) -> None:
        self.clients = [item for item in self.clients if item[0] is not ws]

    async def publish(self, event: dict) -> None:
        data = event.get("data") or {}
        kind = event.get("type")
        # Throttle scalar readings only. Cardiogram chunks must not be rate-limited
        # (otherwise the strip starves to ~5 Hz and looks broken).
        if kind == "reading":
            key = (data.get("astronaut_id"), data.get("sensor_id"))
            moment = time.time()
            if moment - self._last.get(key, 0) < self.reading_gap:
                return
            self._last[key] = moment
        dead = []
        for ws, who, user in self.clients:
            if who and data.get("astronaut_id") not in (None, who):
                continue
            if not _visible(user, event, self):
                continue
            payload = event
            if kind == "status":
                from api.status import _view

                payload = {"type": "status", "data": _view(user, data), "ts": event.get("ts")}
            try:
                await ws.send_json(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.drop(ws)


def _visible(user: dict, event: dict, hub: Hub) -> bool:
    from access import sensors_for

    data = event.get("data") or {}
    kind = event.get("type")
    if kind == "earth_packet":
        return user["role"] in {"doctor", "chief"}
    if kind == "breakglass":
        if user["role"] == "officer":
            return True
        return user["role"] == "astronaut" and data.get("astronaut_id") == user.get("astronaut_id")
    sensor = data.get("sensor_id")
    if user["role"] == "astronaut" and data.get("astronaut_id") not in (None, user.get("astronaut_id")):
        return False
    if user["role"] == "officer" and data.get("astronaut_id") not in (None, user.get("astronaut_id")):
        return False
    # ecg_chunk carries sensor_id=ecg — same ACL as a scalar reading.
    if sensor and sensor not in sensors_for(user["role"]) and sensor != "HELP_NEEDED":
        return False
    if user["role"] == "officer" and sensor == "HELP_NEEDED":
        return False
    if user["role"] in {"doctor", "chief"} and hub.delay > 0 and hub.clock is not None:
        ts = event.get("ts") or data.get("ts")
        if ts is not None and float(ts) > hub.clock.now - hub.delay:
            return False
    return True


@router.websocket("/live")
async def live(ws: WebSocket, token: str | None = None, astronaut_id: str | None = None) -> None:
    from db import connect

    if not token:
        await ws.accept()
        await ws.close(code=4401)
        return
    cx = await connect()
    try:
        row = await (
            await cx.execute(
                """SELECT u.id, u.login, u.role, u.name, u.astronaut_id
                   FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token=?""",
                (token,),
            )
        ).fetchone()
    finally:
        await cx.close()
    if row is None:
        await ws.accept()
        await ws.close(code=4401)
        return
    hub: Hub = ws.app.state.hub
    await hub.connect(ws, astronaut_id, dict(row))
    try:
        await ws.send_json({"type": "hello", "ts": time.time(), "astronaut_id": astronaut_id})
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        hub.drop(ws)
