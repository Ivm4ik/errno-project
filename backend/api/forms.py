from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from access import CLINICAL, guard_astronaut, guard_sensor, require, write_revision
from clock import now
from db import connect
from sensors import form as forms

router = APIRouter()


class SleepIn(BaseModel):
    astronaut_id: str
    hours: float
    quality: float


class WellbeingIn(BaseModel):
    astronaut_id: str
    score: float
    comfort: float | None = None


class PsychIn(BaseModel):
    astronaut_id: str
    answers: list[float]


class PvtIn(BaseModel):
    astronaut_id: str
    times: list[float]


class VisionIn(BaseModel):
    astronaut_id: str
    score: float


async def _put(request: Request, astronaut_id: str, rows) -> dict:
    user = await require(request)
    # Officer is crew: may submit own forms like an astronaut; never for someone else.
    if user["role"] == "officer" and astronaut_id != user.get("astronaut_id"):
        raise HTTPException(403, "Офіцер надсилає лише свої анкети")
    guard_astronaut(user, astronaut_id, request.app.state.astronaut_ids)
    # Ship clock, not the wall. Retention drops anything a day behind the newest packet.
    stamp = float(request.app.state.clock.now)
    for row in rows:
        row.ts = stamp
        if user["role"] not in CLINICAL:
            guard_sensor(user, row.sensor_id)
        request.app.state.queue.put_nowait(row)
    if user["role"] in CLINICAL and rows:
        cx = await connect()
        try:
            diffs = []
            for row in rows:
                prev = await (
                    await cx.execute(
                        "SELECT value FROM readings WHERE astronaut_id=? AND sensor_id=? ORDER BY id DESC LIMIT 1",
                        (astronaut_id, row.sensor_id),
                    )
                ).fetchone()
                diffs.append((row.sensor_id, "value", None if prev is None else prev["value"], row.value))
            await write_revision(cx, user, astronaut_id, diffs, None, now())
            await cx.commit()
        finally:
            await cx.close()
    return {"accepted": len(rows)}


@router.post("/forms/sleep")
async def sleep(body: SleepIn, request: Request) -> dict:
    try:
        rows = forms.sleep(body.astronaut_id, body.hours, body.quality)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return await _put(request, body.astronaut_id, rows)


@router.post("/forms/wellbeing")
async def wellbeing(body: WellbeingIn, request: Request) -> dict:
    try:
        rows = forms.wellbeing(body.astronaut_id, body.score, body.comfort)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return await _put(request, body.astronaut_id, rows)


@router.post("/forms/psych")
async def psych(body: PsychIn, request: Request) -> dict:
    try:
        rows = forms.psych(body.astronaut_id, body.answers)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return await _put(request, body.astronaut_id, rows)


@router.post("/forms/pvt")
async def pvt(body: PvtIn, request: Request) -> dict:
    return await _put(request, body.astronaut_id, forms.pvt(body.astronaut_id, body.times))


@router.post("/forms/vision")
async def vision(body: VisionIn, request: Request) -> dict:
    return await _put(request, body.astronaut_id, forms.vision(body.astronaut_id, body.score))
