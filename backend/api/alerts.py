from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from clock import now
from api.guard import cutoff_for, guard_values
from db import append_audit, connect
from earth_link import enqueue_action

router = APIRouter()


class ActionIn(BaseModel):
    astronaut_id: str
    alert_id: int
    action: str


@router.get("/alerts")
async def alerts(request: Request, astronaut_id: str | None = None, active: bool = True) -> list[dict]:
    from access import require, sensors_for

    user = await require(request)
    if user["role"] == "astronaut":
        astronaut_id = user["astronaut_id"]
    elif user["role"] == "officer" and astronaut_id and astronaut_id != user.get("astronaut_id"):
        await guard_values(request, user, astronaut_id)
    elif user["role"] == "officer":
        astronaut_id = user.get("astronaut_id")
    allowed = sensors_for(user["role"])
    until = cutoff_for(request, user)
    sql = "SELECT id, ts, astronaut_id, sensor_id, category, level, message, explanation, acknowledged FROM alerts WHERE 1=1"
    args: list = []
    if astronaut_id:
        sql += " AND astronaut_id=?"
        args.append(astronaut_id)
    if until is not None:
        sql += " AND ts<=?"
        args.append(until)
    if active:
        sql += " AND acknowledged=0"
    sql += " ORDER BY ts DESC LIMIT 200"
    cx = await connect()
    try:
        rows = await (await cx.execute(sql, args)).fetchall()
    finally:
        await cx.close()
    rows = [dict(row) for row in rows if row["sensor_id"] in allowed or row["sensor_id"] == "HELP_NEEDED"]
    if user["role"] == "officer":
        rows = [row for row in rows if row["level"] in {"watch", "act"} and row["sensor_id"] != "HELP_NEEDED"]
    if user["role"] == "astronaut":
        rows = [row for row in rows if row["sensor_id"] != "HELP_NEEDED"]
    return rows


@router.post("/alerts/{alert_id}/ack")
async def ack(alert_id: int, request: Request) -> dict:
    from access import CLINICAL, require

    user = await require(request)
    if user["role"] not in CLINICAL:
        raise HTTPException(403, "Тривогу підтверджує лікар")
    cx = await connect()
    try:
        cur = await cx.execute("UPDATE alerts SET acknowledged=1 WHERE id=?", (alert_id,))
        await cx.commit()
        if cur.rowcount == 0:
            raise HTTPException(404, "no such alert")
    finally:
        await cx.close()
    for alert in request.app.state.engine.alerts:
        if alert["id"] == alert_id:
            alert["acknowledged"] = 1
            alert["open"] = False
    return {"ok": True}


@router.post("/actions")
async def actions(body: ActionIn, request: Request) -> dict:
    from access import CLINICAL, require

    user = await require(request)
    if user["role"] == "astronaut":
        raise HTTPException(403, "Дію записує офіцер або лікар")
    if user["role"] not in CLINICAL and user["role"] != "officer":
        raise HTTPException(403, "Дію записує офіцер або лікар")
    ts = request.app.state.clock.now
    direction = "up" if user["role"] in CLINICAL else "down"
    cx = await connect()
    try:
        queued = await enqueue_action(
            cx,
            direction,
            {"astronaut_id": body.astronaut_id, "alert_id": body.alert_id, "action": body.action, "actor": user["login"]},
            ts,
            float(request.app.state.delay),
        )
        await append_audit(cx, request.app.state.key, ts, "action", {**body.model_dump(), "direction": direction, "arrives_at": queued["arrives_at"]})
        await cx.commit()
    finally:
        await cx.close()
    return queued
