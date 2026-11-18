import json
import random

from fastapi import APIRouter, HTTPException, Request

from audit import public_from, verify_rows
from clock import now
from db import connect

router = APIRouter()


@router.get("/audit")
async def audit_log(limit: int = 50) -> list[dict]:
    cx = await connect()
    try:
        rows = await (
            await cx.execute(
                "SELECT id, ts, kind, payload, prev_hash, hash, sig FROM audit_log ORDER BY id DESC LIMIT ?",
                (max(1, min(limit, 500)),),
            )
        ).fetchall()
    finally:
        await cx.close()
    return [dict(row) for row in rows]


@router.get("/audit/verify")
async def verify(request: Request) -> dict:
    cx = await connect()
    try:
        rows = await (
            await cx.execute("SELECT id, ts, kind, payload, prev_hash, hash, sig FROM audit_log ORDER BY id")
        ).fetchall()
    finally:
        await cx.close()
    return verify_rows([dict(row) for row in rows], public_from(request.app.state.key))


@router.post("/audit/tamper")
async def tamper(request: Request) -> dict:
    if not request.app.state.demo:
        raise HTTPException(403, "DEMO_MODE is off")
    cx = await connect()
    try:
        rows = await (await cx.execute("SELECT id, payload FROM audit_log ORDER BY id")).fetchall()
        if not rows:
            raise HTTPException(400, "audit log is empty")
        pick = random.choice(rows[:-1] or rows)
        payload = json.loads(pick["payload"])
        payload["tampered"] = True
        await cx.execute(
            "UPDATE audit_log SET payload=? WHERE id=?",
            (json.dumps(payload, ensure_ascii=False, sort_keys=True), pick["id"]),
        )
        await cx.commit()
    finally:
        await cx.close()
    return {"ok": True, "id": pick["id"], "ts": now()}
