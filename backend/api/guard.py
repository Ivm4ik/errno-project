"""Value visibility. Hiding is done here, before a response is built."""

from fastapi import HTTPException, Request

from access import guard_astronaut
from db import append_audit, connect
from earth_link import visible_until


async def guard_values(request: Request, user: dict, astronaut_id: str) -> str:
    """Return own, clinical, or glass. Officer access to someone else is logged."""
    guard_astronaut(user, astronaut_id, request.app.state.astronaut_ids)
    if user["role"] in {"doctor", "chief"}:
        return "clinical"
    if user["role"] == "astronaut":
        if astronaut_id != user["astronaut_id"]:
            raise HTTPException(403, "Космонавт бачить тільки свої дані")
        return "own"
    if user["role"] == "officer" and astronaut_id == user.get("astronaut_id"):
        return "own"
    if user["role"] != "officer":
        raise HTTPException(403, "Немає доступу до цих даних")
    cx = await connect()
    try:
        row = await (
            await cx.execute("SELECT break_glass, incident_id FROM status_state WHERE astronaut_id=?", (astronaut_id,))
        ).fetchone()
        if row is None or not row["break_glass"]:
            raise HTTPException(403, "Немає активного break-glass")
        ts = request.app.state.clock.now
        await cx.execute(
            "INSERT INTO breakglass_access_log(ts, actor_login, astronaut_id, incident_id) VALUES(?, ?, ?, ?)",
            (ts, user["login"], astronaut_id, row["incident_id"]),
        )
        await append_audit(
            cx,
            request.app.state.key,
            ts,
            "breakglass_access",
            {"actor": user["login"], "astronaut_id": astronaut_id, "incident_id": row["incident_id"]},
        )
        await cx.commit()
    finally:
        await cx.close()
    return "glass"


def cutoff_for(request: Request, user: dict) -> float | None:
    return visible_until(user["role"], request.app.state.clock, float(request.app.state.delay))
