from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from access import CLINICAL, bounds_for, guard_astronaut, guard_sensor, out_of_range, require, sensors_for, write_revision
from api.guard import cutoff_for, guard_values
from api.guard import cutoff_for, guard_values
from zones import zone
from clock import now
from db import connect
from sensors.manual import lab

router = APIRouter()


class ManualIn(BaseModel):
    astronaut_id: str
    sensor_id: str
    value: float
    unit: str | None = None


@router.post("/readings/manual")
async def manual(body: ManualIn, request: Request) -> dict:
    user = await require(request)
    if user["role"] not in CLINICAL:
        raise HTTPException(403, "Аналізи вносить лікар")
    guard_astronaut(user, body.astronaut_id, request.app.state.astronaut_ids)
    guard_sensor(user, body.sensor_id)
    metric = request.app.state.metrics_by_id.get(body.sensor_id)
    if metric is None:
        raise HTTPException(400, "unknown sensor")
    reading = lab(body.astronaut_id, body.sensor_id, body.value, body.unit or metric["unit"])
    bounds = metric.get("plausible")
    if bounds and not bounds[0] <= reading.value <= bounds[1]:
        reading.quality = 0
    request.app.state.queue.put_nowait(reading)
    cx = await connect()
    try:
        prev = await (
            await cx.execute(
                "SELECT value FROM readings WHERE astronaut_id=? AND sensor_id=? ORDER BY id DESC LIMIT 1",
                (body.astronaut_id, body.sensor_id),
            )
        ).fetchone()
        await write_revision(
            cx,
            user,
            body.astronaut_id,
            [(body.sensor_id, "value", None if prev is None else prev["value"], body.value)],
            None,
            now(),
        )
        await cx.commit()
    finally:
        await cx.close()
    return {"accepted": 1}


class EditIn(BaseModel):
    value: float
    note: str | None = None


@router.put("/readings/{reading_id}")
async def edit_reading(reading_id: int, body: EditIn, request: Request) -> dict:
    user = await require(request)
    if user["role"] not in CLINICAL:
        raise HTTPException(403, "Дані змінює лікар")
    cx = await connect()
    try:
        row = await (await cx.execute("SELECT * FROM readings WHERE id=?", (reading_id,))).fetchone()
        if row is None:
            raise HTTPException(404, "Немає такого запису")
        guard_sensor(user, row["sensor_id"])
        await cx.execute("UPDATE readings SET value=? WHERE id=?", (body.value, reading_id))
        await write_revision(
            cx,
            user,
            row["astronaut_id"],
            [(row["sensor_id"], "value", row["value"], body.value)],
            body.note,
            now(),
        )
        latest = await (
            await cx.execute(
                "SELECT id FROM readings WHERE astronaut_id=? AND sensor_id=? ORDER BY id DESC LIMIT 1",
                (row["astronaut_id"], row["sensor_id"]),
            )
        ).fetchone()
        await cx.commit()
    finally:
        await cx.close()
    if latest and latest["id"] == reading_id:
        state = request.app.state.engine.states.get((row["astronaut_id"], row["sensor_id"]))
        if state is not None:
            state.last_value = body.value
    return {"id": reading_id, "value": body.value}


@router.get("/readings")
async def readings(
    request: Request,
    astronaut_id: str,
    sensor_id: str | None = None,
    from_: float | None = Query(default=None, alias="from"),
    to: float | None = None,
    resolution: str = "raw",
) -> list[dict]:
    user = await require(request)
    kind = await guard_values(request, user, astronaut_id)
    allowed = sensors_for(user["role"], break_glass=kind == "glass")
    if sensor_id and sensor_id not in allowed:
        raise HTTPException(403, "Ця група показників недоступна для цієї ролі")
    until = cutoff_for(request, user)
    end = request.app.state.clock.now if to is None else to
    if until is not None:
        end = min(end, until)
    start = end - 3600 if from_ is None else from_
    if resolution == "1m":
        sql = "SELECT ts, astronaut_id, sensor_id, avg AS value, min, max, n FROM rollups_1m WHERE astronaut_id=? AND ts>=? AND ts<?"
        args: list = [astronaut_id, start, end]
        if sensor_id:
            sql += " AND sensor_id=?"
            args.append(sensor_id)
        sql += " ORDER BY ts"
    else:
        sql = "SELECT id, ts, astronaut_id, sensor_id, value, unit, quality, source, device_id FROM readings WHERE astronaut_id=? AND ts>=? AND ts<?"
        args = [astronaut_id, start, end]
        if sensor_id:
            sql += " AND sensor_id=?"
            args.append(sensor_id)
        else:
            # Waveform sensors stream via /live strip; bulk hour dumps would be huge.
            sql += " AND sensor_id NOT IN ('ecg')"
        sql += " ORDER BY ts"
    cx = await connect()
    try:
        rows = await (await cx.execute(sql, args)).fetchall()
    finally:
        await cx.close()
    visible = []
    for row in rows:
        if row["sensor_id"] not in allowed:
            continue
        item = dict(row)
        bounds = bounds_for(request.app.state.limits, astronaut_id, row["sensor_id"])
        item["zone"] = zone(row["sensor_id"], item["value"]) or "green"
        item["alert"] = out_of_range(item["value"], bounds)
        visible.append(item)
    return visible


@router.get("/range-alerts")
async def range_alerts(request: Request, astronaut_id: str | None = None) -> list[dict]:
    user = await require(request)
    if user["role"] == "astronaut":
        astronaut_id = user["astronaut_id"]
    elif user["role"] == "officer" and astronaut_id is None:
        astronaut_id = user["astronaut_id"]
    elif astronaut_id:
        await guard_values(request, user, astronaut_id)
    allowed = sensors_for(user["role"])
    until = cutoff_for(request, user)
    cx = await connect()
    try:
        sql = """SELECT r.id, r.ts, r.astronaut_id, r.sensor_id, r.value, r.unit
                 FROM readings r
                 JOIN (
                   SELECT astronaut_id, sensor_id, MAX(id) AS id FROM readings WHERE 1=1"""
        args: list = []
        if until is not None:
            sql += " AND ts<=?"
            args.append(until)
        sql += " GROUP BY astronaut_id, sensor_id) latest ON latest.id = r.id"
        if astronaut_id:
            sql += " WHERE r.astronaut_id=?"
            args.append(astronaut_id)
        rows = await (await cx.execute(sql, args)).fetchall()
    finally:
        await cx.close()
    found = []
    for row in rows:
        if row["sensor_id"] not in allowed:
            continue
        if user["role"] == "officer" and row["astronaut_id"] != user.get("astronaut_id"):
            continue
        bounds = bounds_for(request.app.state.limits, row["astronaut_id"], row["sensor_id"])
        if not out_of_range(row["value"], bounds):
            continue
        item = dict(row)
        low, high = bounds or (None, None)
        item["min"] = low
        item["max"] = high
        item["alert"] = True
        found.append(item)
    return found
