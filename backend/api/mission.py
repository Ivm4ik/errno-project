"""Penalties, HUD, break-glass, Earth packets. No secrets."""

import json

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from access import CLINICAL, require, sensors_for
from api.guard import cutoff_for, guard_values
from db import append_audit, connect
from scoring.rules import load_rules

router = APIRouter()
RULES = {rule.metric: rule for rule in load_rules()}
CRITICAL = "КРИТИЧНИЙ СТАН! Негайно припини роботу та очікуй допомоги екіпажу"


class StepIn(BaseModel):
    text: str
    done: bool = False


def _allowed_rows(user: dict, rows: list[dict], glass: bool) -> list[dict]:
    from main import app

    allowed = sensors_for(user["role"], break_glass=glass or user["role"] in CLINICAL)
    sensor_of = app.state.clinical.sensor_of
    visible = []
    for row in rows:
        sensor = sensor_of.get(row["metric"])
        if sensor in allowed:
            visible.append(row)
    return visible


async def _latest_penalty(cx, astronaut_id: str, until: float | None) -> dict | None:
    sql = "SELECT ts, health_index, total, status, breakdown FROM penalty_log WHERE astronaut_id=?"
    args: list = [astronaut_id]
    if until is not None:
        sql += " AND ts<=?"
        args.append(until)
    sql += " ORDER BY id DESC LIMIT 1"
    return await (await cx.execute(sql, args)).fetchone()


async def _state_row(cx, astronaut_id: str, until: float | None):
    if until is None:
        return await (await cx.execute("SELECT * FROM status_state WHERE astronaut_id=?", (astronaut_id,))).fetchone()
    return await (
        await cx.execute(
            "SELECT ts, astronaut_id, status, health_index, total, reason FROM status_history WHERE astronaut_id=? AND ts<=? ORDER BY id DESC LIMIT 1",
            (astronaut_id, until),
        )
    ).fetchone()


@router.get("/penalties")
async def penalties(request: Request, astronaut_id: str) -> dict:
    user = await require(request)
    kind = await guard_values(request, user, astronaut_id)
    until = cutoff_for(request, user)
    cx = await connect()
    try:
        row = await _latest_penalty(cx, astronaut_id, until)
    finally:
        await cx.close()
    if row is None:
        return {"astronaut_id": astronaut_id, "health_index": 100, "total": 0, "rows": []}
    rows = _allowed_rows(user, json.loads(row["breakdown"]), kind == "glass")
    return {
        "astronaut_id": astronaut_id,
        "ts": row["ts"],
        "health_index": row["health_index"],
        "total": sum(item["penalty"] for item in rows) if kind != "glass" and user["role"] not in CLINICAL else row["total"],
        "rows": rows,
    }


@router.get("/status/history")
async def status_history(request: Request, astronaut_id: str) -> list[dict]:
    user = await require(request)
    await guard_values(request, user, astronaut_id)
    until = cutoff_for(request, user)
    sql = "SELECT ts, astronaut_id, status, from_status, health_index, total, reason FROM status_history WHERE astronaut_id=?"
    args: list = [astronaut_id]
    if until is not None:
        sql += " AND ts<=?"
        args.append(until)
    sql += " ORDER BY id DESC LIMIT 200"
    cx = await connect()
    try:
        rows = await (await cx.execute(sql, args)).fetchall()
    finally:
        await cx.close()
    return [dict(row) for row in rows]


@router.get("/status/spark")
async def status_spark(request: Request, astronaut_id: str) -> list[dict]:
    """Last ship-hour of health_index for the medic overview sparkline."""
    user = await require(request)
    await guard_values(request, user, astronaut_id)
    until = cutoff_for(request, user)
    end = until if until is not None else float(request.app.state.clock.now)
    start = end - 3600
    cx = await connect()
    try:
        rows = await (
            await cx.execute(
                """SELECT ts, health_index FROM penalty_log
                   WHERE astronaut_id=? AND ts>=? AND ts<=?
                   ORDER BY id""",
                (astronaut_id, start, end),
            )
        ).fetchall()
    finally:
        await cx.close()
    items = [{"ts": row["ts"], "health_index": row["health_index"]} for row in rows]
    if len(items) > 40:
        step = len(items) / 40
        items = [items[int(i * step)] for i in range(40)]
    return items


@router.get("/hud")
async def hud(request: Request, astronaut_id: str) -> dict:
    user = await require(request)
    kind = await guard_values(request, user, astronaut_id)
    until = cutoff_for(request, user)
    cx = await connect()
    try:
        state = await _state_row(cx, astronaut_id, until)
        row = await _latest_penalty(cx, astronaut_id, until)
    finally:
        await cx.close()
    status = 0 if state is None else int(state["status"])
    rows = [] if row is None else _allowed_rows(user, json.loads(row["breakdown"]), kind == "glass")
    cards = []
    if status >= 1:
        for item in rows:
            if float(item["penalty"]) <= 0:
                continue
            rule = RULES.get(item["metric"])
            cards.append(
                {
                    "metric": item["metric"],
                    "message": rule.hud if rule else "",
                    "penalty": item["penalty"],
                    "breathing": "4-7-8" if item["metric"] == "HR" else None,
                }
            )
    payload = {
        "astronaut_id": astronaut_id,
        "status": status,
        "health_index": 100 if state is None else state["health_index"],
        "activity_mode": None if state is None else state["activity_mode"] if "activity_mode" in state.keys() else None,
        "cards": [] if status == 0 else cards,
        "critical_text": CRITICAL if status == 2 else None,
    }
    # #region agent log
    try:
        import time as _time
        with open("/home/ivm/NASA/.cursor/debug-b393a4.log", "a", encoding="utf-8") as _fh:
            _fh.write(
                __import__("json").dumps(
                    {
                        "sessionId": "b393a4",
                        "hypothesisId": "D",
                        "location": "mission.py:hud",
                        "message": "hud-response",
                        "data": {
                            "astronaut_id": astronaut_id,
                            "status": payload["status"],
                            "health_index": payload["health_index"],
                            "clear_hold": None if state is None else state["clear_hold"],
                            "total": None if state is None else state["total"],
                            "cards": len(payload["cards"]),
                            "has_critical_text": payload["critical_text"] is not None,
                        },
                        "timestamp": int(_time.time() * 1000),
                        "runId": "pre-fix",
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    except Exception:
        pass
    # #endregion
    return payload


@router.get("/crew/readiness")
async def readiness(request: Request) -> list[dict]:
    user = await require(request)
    if user["role"] != "officer":
        raise HTTPException(403, "Готовність екіпажу бачить офіцер")
    cx = await connect()
    try:
        rows = await (await cx.execute("SELECT astronaut_id, status, break_glass FROM status_state")).fetchall()
    finally:
        await cx.close()
    known = {row["astronaut_id"]: row for row in rows}
    out = []
    for person in request.app.state.crew:
        row = known.get(person["id"])
        status = 0 if row is None else int(row["status"])
        if row is not None and row["break_glass"]:
            flag = "red-breakglass"
        elif status >= 2:
            flag = "red-breakglass"
        elif status == 1:
            flag = "yellow"
        else:
            flag = "green"
        out.append({"astronaut_id": person["id"], "name": person["name"], "readiness": flag})
    return out


@router.get("/emergency/{astronaut_id}")
async def emergency(astronaut_id: str, request: Request) -> dict:
    user = await require(request)
    if user["role"] != "officer":
        raise HTTPException(403, "Аварійний пакет відкриває офіцер")
    kind = await guard_values(request, user, astronaut_id)
    if kind != "glass":
        raise HTTPException(403, "Break-glass не активний")
    cx = await connect()
    try:
        state = await (await cx.execute("SELECT * FROM status_state WHERE astronaut_id=?", (astronaut_id,))).fetchone()
        penalty = await _latest_penalty(cx, astronaut_id, None)
        steps = []
        if state and state["incident_id"]:
            steps = await (
                await cx.execute("SELECT id, ts, actor_login, text, done FROM incident_steps WHERE incident_id=? ORDER BY id", (state["incident_id"],))
            ).fetchall()
    finally:
        await cx.close()
    rows = [] if penalty is None else json.loads(penalty["breakdown"])
    protocols = []
    for item in rows:
        if float(item["penalty"]) <= 0:
            continue
        rule = RULES.get(item["metric"])
        if rule:
            protocols.append({"metric": item["metric"], "protocol": rule.cmo})
    return {
        "astronaut_id": astronaut_id,
        "incident_id": None if state is None else state["incident_id"],
        "status": 0 if state is None else state["status"],
        "health_index": None if state is None else state["health_index"],
        "activity_mode": None if state is None else state["activity_mode"],
        "rows": rows,
        "protocols": protocols,
        "steps": [dict(step) for step in steps],
        "note": "Відповідь Землі прийде після затримки сигналу.",
    }


@router.get("/incidents")
async def incidents(request: Request) -> list[dict]:
    user = await require(request)
    if user["role"] not in CLINICAL and user["role"] != "officer":
        raise HTTPException(403, "Інциденти бачить офіцер або лікар")
    until = cutoff_for(request, user)
    sql = "SELECT id, astronaut_id, opened_at, closed_at, break_glass, trigger_json FROM incidents WHERE 1=1"
    args: list = []
    if until is not None:
        sql += " AND opened_at<=?"
        args.append(until)
    if user["role"] == "officer":
        sql += " AND (break_glass=1 OR astronaut_id=?)"
        args.append(user.get("astronaut_id"))
    sql += " ORDER BY id DESC LIMIT 100"
    cx = await connect()
    try:
        rows = await (await cx.execute(sql, args)).fetchall()
    finally:
        await cx.close()
    return [dict(row) for row in rows]


@router.post("/incidents/{incident_id}/steps")
async def add_step(incident_id: int, body: StepIn, request: Request) -> dict:
    user = await require(request)
    if user["role"] not in CLINICAL and user["role"] != "officer":
        raise HTTPException(403, "Крок записує офіцер або лікар")
    ts = request.app.state.clock.now
    cx = await connect()
    try:
        found = await (await cx.execute("SELECT id FROM incidents WHERE id=?", (incident_id,))).fetchone()
        if found is None:
            raise HTTPException(404, "Немає такого інциденту")
        cur = await cx.execute(
            "INSERT INTO incident_steps(incident_id, ts, actor_login, text, done) VALUES(?, ?, ?, ?, ?)",
            (incident_id, ts, user["login"], body.text, int(body.done)),
        )
        await cx.commit()
    finally:
        await cx.close()
    return {"id": cur.lastrowid}


@router.post("/incidents/{incident_id}/close")
async def close_incident(incident_id: int, request: Request) -> dict:
    user = await require(request)
    if user["role"] not in CLINICAL and user["role"] != "officer":
        raise HTTPException(403, "Інцидент закриває офіцер або лікар")
    ts = request.app.state.clock.now
    cx = await connect()
    try:
        row = await (await cx.execute("SELECT astronaut_id FROM incidents WHERE id=?", (incident_id,))).fetchone()
        if row is None:
            raise HTTPException(404, "Немає такого інциденту")
        await cx.execute("UPDATE incidents SET closed_at=?, break_glass=0 WHERE id=?", (ts, incident_id))
        await cx.execute(
            "UPDATE status_state SET break_glass=0 WHERE astronaut_id=? AND incident_id=?",
            (row["astronaut_id"], incident_id),
        )
        await append_audit(cx, request.app.state.key, ts, "breakglass", {"astronaut_id": row["astronaut_id"], "incident_id": incident_id, "active": False, "why": "close"})
        await cx.commit()
    finally:
        await cx.close()
    request.app.state.clinical.glass[row["astronaut_id"]] = None
    return {"ok": True}


def _packet_view(row, sim_now: float, reveal: bool) -> dict:
    waiting = sim_now + 1e-6 < row["visible_at"]
    body = None if waiting or not reveal else json.loads(row["payload"])
    return {
        "id": row["id"],
        "astronaut_id": row["astronaut_id"],
        "created_at": row["created_at"],
        "visible_at": row["visible_at"],
        "in_transit": waiting,
        "eta_sec": max(0.0, row["visible_at"] - sim_now),
        "message": "signal in transit, ETA" if waiting else None,
        "payload": body,
    }


@router.get("/earth/actions")
async def earth_actions(request: Request) -> list[dict]:
    """Officer → Earth messages (and doctor → ship). From earth_queue so actor/text survive delivery."""
    user = await require(request)
    if user["role"] not in CLINICAL and user["role"] != "officer":
        raise HTTPException(403, "Дії зв'язку бачить офіцер або лікар")
    sim_now = request.app.state.clock.now
    cx = await connect()
    try:
        rows = await (
            await cx.execute(
                "SELECT id, direction, payload, created_at, arrives_at, delivered FROM earth_queue WHERE kind='action' ORDER BY id DESC LIMIT 100"
            )
        ).fetchall()
    finally:
        await cx.close()
    out = []
    for row in rows:
        body = json.loads(row["payload"] or "{}")
        direction = row["direction"]
        # Officer sees both; doctor primarily needs down (from ship). Show both either way.
        waiting = int(row["delivered"] or 0) == 0 and sim_now + 1e-6 < float(row["arrives_at"])
        out.append(
            {
                "id": row["id"],
                "direction": direction,
                "astronaut_id": body.get("astronaut_id"),
                "actor": body.get("actor"),
                "action": body.get("action"),
                "alert_id": body.get("alert_id"),
                "created_at": row["created_at"],
                "arrives_at": row["arrives_at"],
                "delivered": int(row["delivered"] or 0) == 1,
                "in_transit": waiting,
                "eta_sec": max(0.0, float(row["arrives_at"]) - sim_now) if waiting else 0.0,
            }
        )
    if user["role"] in CLINICAL:
        return [item for item in out if item["direction"] == "down"]
    return [item for item in out if item["direction"] == "up"]


@router.get("/earth/packets")
async def packets(request: Request) -> list[dict]:
    user = await require(request)
    if user["role"] not in CLINICAL:
        raise HTTPException(403, "Пакети Землі бачить лікар")
    cx = await connect()
    try:
        rows = await (await cx.execute("SELECT * FROM earth_packets ORDER BY id DESC LIMIT 50")).fetchall()
    finally:
        await cx.close()
    return [_packet_view(row, request.app.state.clock.now, True) for row in rows]


@router.get("/earth/packets/{packet_id}")
async def packet(packet_id: int, request: Request) -> dict:
    user = await require(request)
    if user["role"] not in CLINICAL:
        raise HTTPException(403, "Пакети Землі бачить лікар")
    cx = await connect()
    try:
        row = await (await cx.execute("SELECT * FROM earth_packets WHERE id=?", (packet_id,))).fetchone()
    finally:
        await cx.close()
    if row is None:
        raise HTTPException(404, "Немає такого пакета")
    return _packet_view(row, request.app.state.clock.now, True)


@router.get("/earth/warning-log")
async def warning_log(request: Request, astronaut_id: str | None = None) -> list[dict]:
    user = await require(request)
    if user["role"] not in CLINICAL:
        raise HTTPException(403, "Журнал попереджень бачить лікар")
    until = cutoff_for(request, user)
    sql = "SELECT ts, astronaut_id, breakdown FROM penalty_log WHERE status=1"
    args: list = []
    if astronaut_id:
        sql += " AND astronaut_id=?"
        args.append(astronaut_id)
    if until is not None:
        sql += " AND ts<=?"
        args.append(until)
    sql += " ORDER BY id DESC LIMIT 100"
    cx = await connect()
    try:
        rows = await (await cx.execute(sql, args)).fetchall()
    finally:
        await cx.close()
    out = []
    for row in rows:
        for item in json.loads(row["breakdown"]):
            if float(item["penalty"]) <= 0:
                continue
            rule = RULES.get(item["metric"])
            out.append(
                {
                    "ts": row["ts"],
                    "astronaut_id": row["astronaut_id"],
                    "metric": item["metric"],
                    "penalty": item["penalty"],
                    "message": rule.hud if rule else "",
                }
            )
    return out


@router.get("/config/public")
async def public_config(request: Request) -> dict:
    await require(request)
    # Display mock for Earth lag. Live scoring still uses SIGNAL_DELAY_SEC (often 0 in demos).
    return {
        "mission": "ERRNO — транзит до Марса",
        "signal_delay_sec": request.app.state.delay,
        "signal_delay_label": "30:00",
        "eval_interval": 5,
        "statuses": ["NO_DOCTOR_NEEDED", "ALLOW_FINISH_MISSION", "CALL_DOCTOR_NOW"],
        "disclaimer": "Симуляція для навчання. Не медична порада. Затримка зв'язку з Марсом — 30 хвилин (муляж).",
        "limits_apply_immediately": True,
    }
