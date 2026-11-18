from fastapi import APIRouter, HTTPException, Request

from access import SENSOR_GROUP, bounds_for, out_of_range, require, sensors_for
from api.guard import cutoff_for, guard_values
from db import connect
from scoring.validate import FORM_PENDING, SENSOR_ANOMALY, classify_sensor, is_fault, validate_sensor_data
from zones import zone

router = APIRouter()


@router.get("/astronauts")
async def astronauts(request: Request) -> list[dict]:
    user = await require(request)
    if user["role"] == "astronaut":
        return [item for item in request.app.state.crew if item["id"] == user["astronaut_id"]]
    return request.app.state.crew


@router.get("/metrics")
async def metrics(request: Request) -> list[dict]:
    user = await require(request)
    engine = request.app.state.engine
    glass_people: set[str] = set()
    if user["role"] == "astronaut":
        people = [user["astronaut_id"]]
        allowed = sensors_for(user["role"])
    elif user["role"] == "officer":
        people = [user["astronaut_id"]] if user.get("astronaut_id") else []
        allowed = sensors_for("officer")
        # Break-glass: add critical crew with the wider sensor set (still only while glass is on).
        cx = await connect()
        try:
            rows = await (await cx.execute("SELECT astronaut_id FROM status_state WHERE break_glass=1")).fetchall()
        finally:
            await cx.close()
        glass_people = {row["astronaut_id"] for row in rows if row["astronaut_id"] != user.get("astronaut_id")}
        people = list(dict.fromkeys([*people, *glass_people]))
        if glass_people:
            allowed = sensors_for("officer", break_glass=True)
    else:
        people = request.app.state.astronaut_ids
        allowed = sensors_for(user["role"])
    until = cutoff_for(request, user)
    # Always read latest from SQLite so a cold engine (no in-process drivers) still fills cards.
    delayed = await _delayed_latest(people, allowed, until)

    # Collect per-astronaut peer maps for Sensor Fusion cross-validation.
    peers_by: dict[str, dict[str, float]] = {astronaut: {} for astronaut in people}
    meta_by: dict[tuple[str, str], tuple[float, float, dict]] = {}
    for metric in request.app.state.metrics:
        if metric["id"] not in allowed:
            continue
        for astronaut in people:
            if user["role"] == "officer" and astronaut != user.get("astronaut_id") and astronaut not in glass_people:
                continue
            if user["role"] == "officer" and astronaut == user.get("astronaut_id") and metric["id"] not in sensors_for("officer"):
                continue
            item = delayed.get((astronaut, metric["id"]))
            if item is None:
                st = engine.states.get((astronaut, metric["id"]))
                if st is None or st.last_value is None:
                    continue
                value, ts = st.last_value, st.updated
            else:
                value, ts = item["value"], item["ts"]
            peers_by[astronaut][metric["id"]] = value
            meta_by[(astronaut, metric["id"])] = (value, ts, metric)

    out = []
    for metric in request.app.state.metrics:
        if metric["id"] not in allowed:
            continue
        latest = []
        for astronaut in people:
            if user["role"] == "officer" and astronaut != user.get("astronaut_id") and astronaut not in glass_people:
                continue
            if user["role"] == "officer" and astronaut == user.get("astronaut_id") and metric["id"] not in sensors_for("officer"):
                continue
            hit = meta_by.get((astronaut, metric["id"]))
            if hit is None:
                continue
            value, ts, _metric = hit
            limits = bounds_for(request.app.state.limits, astronaut, metric["id"])
            status = classify_sensor(metric["id"], value, metric.get("plausible"), peers_by.get(astronaut))
            if status == FORM_PENDING:
                latest.append(
                    {
                        "astronaut_id": astronaut,
                        "value": value,
                        "ts": ts,
                        "alert": False,
                        "zone": None,
                        "signal_lost": False,
                        "sensor_anomaly": False,
                        "form_pending": True,
                        "anomaly_kind": None,
                    }
                )
                continue
            if is_fault(status):
                single = validate_sensor_data(metric["id"], value, metric.get("plausible"))
                kind = "fusion" if status == SENSOR_ANOMALY and single == "OK" else ("bounds" if status == SENSOR_ANOMALY else "lost")
                latest.append(
                    {
                        "astronaut_id": astronaut,
                        "value": value,
                        "ts": ts,
                        "alert": False,
                        "zone": None,
                        "signal_lost": True,
                        "sensor_anomaly": status == SENSOR_ANOMALY,
                        "form_pending": False,
                        "anomaly_kind": kind,
                    }
                )
                continue
            band = zone(metric["id"], value)
            latest.append(
                {
                    "astronaut_id": astronaut,
                    "value": value,
                    "ts": ts,
                    "alert": out_of_range(value, limits),
                    "zone": band or "green",
                    "signal_lost": False,
                    "sensor_anomaly": False,
                    "form_pending": False,
                    "anomaly_kind": None,
                }
            )
        out.append(
            {
                "id": metric["id"],
                "name_uk": metric["name_uk"],
                "group": SENSOR_GROUP.get(metric["id"]),
                # Keep the panel's cadence labels tied to the same source as ingest.
                "mode": metric.get("mode", "interval"),
                "interval_s": metric.get("interval_s", 0),
                "unit": metric["unit"],
                "source": metric.get("_source", metric["source"]),
                "latest": latest,
            }
        )
    return out


@router.get("/status")
async def status(request: Request, astronaut_id: str | None = None) -> dict | list:
    user = await require(request)
    if user["role"] == "astronaut":
        astronaut_id = user["astronaut_id"]
    elif user["role"] == "officer" and astronaut_id is None:
        astronaut_id = user["astronaut_id"]
    ids = [astronaut_id] if astronaut_id else request.app.state.astronaut_ids
    rows = [await _status_view(request, user, item) for item in ids]
    if astronaut_id and not rows:
        raise HTTPException(404, "Немає такого космонавта")
    return rows[0] if astronaut_id else rows


async def _delayed_latest(people: list[str], allowed: set[str], until: float | None) -> dict:
    if not people:
        return {}
    marks = ",".join("?" for _ in people)
    where = f"astronaut_id IN ({marks})"
    args: list = list(people)
    if until is not None:
        where += " AND ts<=?"
        args.append(until)
    cx = await connect()
    try:
        rows = await (
            await cx.execute(
                f"""SELECT r.astronaut_id, r.sensor_id, r.value, r.ts FROM readings r
                    JOIN (
                      SELECT astronaut_id, sensor_id, MAX(id) AS id FROM readings
                      WHERE {where}
                      GROUP BY astronaut_id, sensor_id
                    ) x ON x.id = r.id""",
                tuple(args),
            )
        ).fetchall()
    finally:
        await cx.close()
    return {(row["astronaut_id"], row["sensor_id"]): dict(row) for row in rows if row["sensor_id"] in allowed}


async def _status_view(request: Request, user: dict, astronaut_id: str) -> dict:
    kind = await guard_values(request, user, astronaut_id)
    until = cutoff_for(request, user)
    labels = request.app.state.clinical.status_cfg["labels"]
    cx = await connect()
    try:
        if until is None:
            row = await (await cx.execute("SELECT * FROM status_state WHERE astronaut_id=?", (astronaut_id,))).fetchone()
        else:
            row = await (
                await cx.execute(
                    "SELECT status, health_index, total, NULL AS activity_mode FROM status_history WHERE astronaut_id=? AND ts<=? ORDER BY id DESC LIMIT 1",
                    (astronaut_id, until),
                )
            ).fetchone()
    finally:
        await cx.close()
    status_code = 0 if row is None else int(row["status"])
    health = 100.0 if row is None else row["health_index"]
    clinical = user["role"] in {"doctor", "chief"} or kind == "glass"
    snap = request.app.state.engine.snapshot(astronaut_id)
    allowed = sensors_for(user["role"], break_glass=kind == "glass")
    alerts = [item for item in snap["alerts"] if item.get("sensor_id") in allowed or item.get("sensor_id") == "HELP_NEEDED"]
    if not clinical:
        alerts = [item for item in alerts if item.get("sensor_id") != "HELP_NEEDED"]
    if until is not None:
        alerts = [item for item in alerts if float(item.get("ts") or 0) <= until]
    return {
        "astronaut_id": astronaut_id,
        "score": round(health, 1),
        "health_index": round(health, 1),
        "level": labels.get(status_code, labels[0]),
        "status": status_code,
        "help_needed": status_code == 2,
        "systems": {} if not clinical else snap["systems"],
        "alerts": alerts,
        "activity_mode": None if row is None else row["activity_mode"],
        "critical_text": request.app.state.clinical.status_cfg["critical_text"] if status_code == 2 else None,
    }


def _view(user: dict, snap: dict) -> dict:
    """Live-socket shim. Penalty status is already on the event when clinical publishes it."""
    allowed = sensors_for(user["role"])
    snap = dict(snap)
    snap["alerts"] = [item for item in snap.get("alerts") or [] if item.get("sensor_id") in allowed or item.get("sensor_id") is None]
    if user["role"] not in {"doctor", "chief"}:
        snap["systems"] = {}
    return snap
