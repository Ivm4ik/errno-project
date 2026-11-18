"""Crew sensor board: status + panel-driven samples (teaching prototype)."""

from __future__ import annotations

import os
import random

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from access import CLINICAL, SENSOR_GROUP, guard_sensor, require, sensors_for
from api.guard import guard_values
from clock import now
from db import connect
from models import Reading

router = APIRouter(prefix="/sensors")

LIVE_SEC = 15
STALE_SEC = 120


class PulseIn(BaseModel):
    astronaut_id: str
    sensor_ids: list[str] = Field(default_factory=list)
    activity_mode: str = "rest"
    count: int = 1


def _link(age: float | None) -> str:
    if age is None:
        return "offline"
    if age <= LIVE_SEC:
        return "live"
    if age <= STALE_SEC:
        return "stale"
    return "offline"


def _baseline(metric: dict) -> float:
    sim = metric.get("sim") or {}
    if "baseline" in sim:
        return float(sim["baseline"])
    ok = (metric.get("norm") or {}).get("ok") or []
    if len(ok) == 2:
        return (float(ok[0]) + float(ok[1])) / 2
    return 0.0


def _noise(metric: dict) -> float:
    sim = metric.get("sim") or {}
    if "noise" in sim:
        return float(sim["noise"])
    return max(abs(_baseline(metric)) * 0.02, 0.05)


@router.get("/board")
async def board(request: Request, astronaut_id: str | None = None) -> dict:
    user = await require(request)
    if user["role"] in CLINICAL:
        raise HTTPException(403, "Панель датчиків для екіпажу на борту")
    target = astronaut_id or user.get("astronaut_id")
    if not target:
        raise HTTPException(422, "Немає astronaut_id")
    kind = await guard_values(request, user, target)
    glass = kind == "glass"
    allowed = sensors_for(user["role"], break_glass=glass)
    metrics = [metric for metric in request.app.state.metrics if metric["id"] in allowed]
    ids = [metric["id"] for metric in metrics]
    latest: dict[str, dict] = {}
    if ids:
        marks = ",".join("?" for _ in ids)
        cx = await connect()
        try:
            rows = await (
                await cx.execute(
                    f"""SELECT r.sensor_id, r.value, r.ts, r.source, r.quality, r.device_id FROM readings r
                        JOIN (
                          SELECT sensor_id, MAX(id) AS id FROM readings
                          WHERE astronaut_id=? AND sensor_id IN ({marks})
                          GROUP BY sensor_id
                        ) x ON x.id = r.id""",
                    (target, *ids),
                )
            ).fetchall()
        finally:
            await cx.close()
        latest = {row["sensor_id"]: dict(row) for row in rows}

    stamp = now()
    engine = request.app.state.engine
    sensors = []
    for metric in metrics:
        hit = latest.get(metric["id"])
        st = engine.states.get((target, metric["id"]))
        # Prefer in-memory state if the writer has not flushed the latest panel pulse yet.
        if st is not None and st.last_value is not None and (hit is None or float(st.updated) >= float(hit["ts"])):
            value, ts, source, quality, device_id = st.last_value, st.updated, "panel", 1.0, None
        elif hit is not None:
            value, ts, source, quality, device_id = hit["value"], hit["ts"], hit["source"], hit["quality"], hit["device_id"]
        else:
            value = ts = source = quality = device_id = None
        age = None if ts is None else max(0.0, stamp - float(ts))
        sensors.append(
            {
                "id": metric["id"],
                "name_uk": metric["name_uk"],
                "unit": metric["unit"],
                "group": SENSOR_GROUP.get(metric["id"]) or metric.get("system") or "Інше",
                "interval_s": metric.get("interval_s"),
                "value": value,
                "ts": ts,
                "age_sec": age,
                "link": _link(age),
                "source": source,
                "quality": quality,
                "device_id": device_id,
            }
        )
    live = sum(1 for item in sensors if item["link"] == "live")
    return {
        "astronaut_id": target,
        "kind": kind,
        "demo": bool(getattr(request.app.state, "demo", False) or os.environ.get("DEMO_MODE", "").lower() in {"1", "true", "yes"}),
        "summary": {"total": len(sensors), "live": live, "stale": sum(1 for item in sensors if item["link"] == "stale"), "offline": sum(1 for item in sensors if item["link"] == "offline")},
        "sensors": sensors,
    }


@router.post("/pulse")
async def pulse(body: PulseIn, request: Request) -> dict:
    """Push one or more panel samples for own (or break-glass) crew member."""
    user = await require(request)
    if user["role"] in CLINICAL:
        raise HTTPException(403, "Панель датчиків для екіпажу на борту")
    kind = await guard_values(request, user, body.astronaut_id)
    if kind == "own" and body.astronaut_id != user.get("astronaut_id"):
        raise HTTPException(403, "Можна генерувати лише свої датчики")
    glass = kind == "glass"
    allowed = sensors_for(user["role"], break_glass=glass)
    wanted = body.sensor_ids or sorted(allowed)
    mode = body.activity_mode if body.activity_mode in {"rest", "exercise", "eva"} else "rest"
    count = max(1, min(body.count, 20))
    by_id = {metric["id"]: metric for metric in request.app.state.metrics}
    accepted = 0
    stamp = now()
    for sensor_id in wanted:
        if sensor_id not in allowed:
            continue
        if user["role"] not in CLINICAL and kind == "own":
            guard_sensor(user, sensor_id)
        metric = by_id.get(sensor_id)
        if metric is None:
            continue
        base = _baseline(metric)
        spread = _noise(metric)
        for step in range(count):
            value = base + random.gauss(0, spread)
            if mode == "exercise" and sensor_id in {"hr", "resp", "lactate"}:
                value = base * (1.35 if sensor_id == "hr" else 1.25 if sensor_id == "resp" else 1.8) + random.gauss(0, spread)
            if sensor_id == "spo2":
                value = min(100.0, max(85.0, value))
            reading = Reading(
                sensor_id=sensor_id,
                astronaut_id=body.astronaut_id,
                value=float(value),
                unit=metric.get("unit") or "",
                ts=stamp + step * 0.05,
                quality=1.0,
                source="panel",
                device_id=f"panel-{user['login']}",
                activity_mode=mode,
            )
            request.app.state.queue.put_nowait(reading)
            request.app.state.engine.step(reading)
            accepted += 1
    return {"accepted": accepted, "astronaut_id": body.astronaut_id, "activity_mode": mode, "ts": stamp}
