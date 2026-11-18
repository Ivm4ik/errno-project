"""Ship clock versus Earth. Delay is simulated time, not the wall clock."""

import json

from config_loader import env_float, load_yaml


def delay_seconds() -> float:
    configured = float(load_yaml("earth.yaml")["SIGNAL_DELAY_SEC"])
    raw = env_float("SIGNAL_DELAY_SEC", configured)
    return raw if raw >= 0 else configured


class SimClock:
    """Unpinned clock is max(packet time, wall). Assigning `.now` pins a test or a replay."""

    def __init__(self) -> None:
        self._sim = 0.0
        self._pinned: float | None = None

    @property
    def now(self) -> float:
        import time

        if self._pinned is not None:
            return self._pinned
        return max(self._sim, time.time())

    @now.setter
    def now(self, value: float) -> None:
        self._pinned = float(value)

    def observe(self, ts: float | None) -> None:
        if ts is None:
            return
        if self._pinned is not None:
            if ts > self._pinned:
                self._pinned = float(ts)
            return
        if ts > self._sim:
            self._sim = float(ts)


def visible_until(role: str, clock: SimClock, delay: float) -> float | None:
    if role not in {"doctor", "chief"} or delay <= 0:
        return None
    return clock.now - delay


async def enqueue_action(cx, direction: str, payload: dict, created: float, delay: float) -> dict:
    arrives = created + delay
    cur = await cx.execute(
        "INSERT INTO earth_queue(direction, kind, payload, created_at, arrives_at, delivered) VALUES(?, 'action', ?, ?, ?, 0)",
        (direction, json.dumps(payload, ensure_ascii=False), created, arrives),
    )
    if arrives <= created:
        await deliver_due(cx, created)
    return {"id": cur.lastrowid, "arrives_at": arrives}


async def deliver_due(cx, sim_now: float) -> None:
    rows = await (
        await cx.execute(
            "SELECT id, payload, arrives_at FROM earth_queue WHERE delivered=0 AND kind='action' AND arrives_at<=?",
            (sim_now,),
        )
    ).fetchall()
    for row in rows:
        body = json.loads(row["payload"])
        await cx.execute(
            "INSERT INTO actions(ts, astronaut_id, alert_id, action) VALUES(?, ?, ?, ?)",
            (row["arrives_at"], body["astronaut_id"], body.get("alert_id"), body["action"]),
        )
        await cx.execute("UPDATE earth_queue SET delivered=1 WHERE id=?", (row["id"],))
