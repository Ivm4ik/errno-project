from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from access import (
    CLINICAL,
    PROVISIONAL,
    guard_astronaut,
    new_token,
    require,
    write_revision,
)
from clock import now
from db import connect

router = APIRouter()


class AccountIn(BaseModel):
    login: str
    role: str
    name: str
    astronaut_id: str | None = None


class LimitIn(BaseModel):
    astronaut_id: str
    sensor_id: str
    min: float | None = None
    max: float | None = None
    note: str | None = None


class SelectIn(BaseModel):
    login: str


def _session_view(token: str, row) -> dict:
    return {
        "token": token,
        "login": row["login"],
        "role": row["role"],
        "name": row["name"],
        "astronaut_id": row["astronaut_id"],
    }


@router.get("/auth/accounts")
async def pick_accounts() -> list[dict]:
    """Accounts shown on the "choose an account" screen."""
    cx = await connect()
    try:
        rows = await (await cx.execute("SELECT login, role, name, astronaut_id FROM users ORDER BY id")).fetchall()
    finally:
        await cx.close()
    return [dict(row) for row in rows]


@router.post("/auth/select")
async def select_account(body: SelectIn) -> dict:
    """Sign in as the chosen account. There are no passwords."""
    cx = await connect()
    try:
        row = await (await cx.execute("SELECT * FROM users WHERE login=?", (body.login,))).fetchone()
        if row is None:
            raise HTTPException(404, "Немає такого облікового запису")
        token = new_token()
        await cx.execute("INSERT INTO sessions(token, user_id) VALUES(?, ?)", (token, row["id"]))
        await cx.commit()
    finally:
        await cx.close()
    return _session_view(token, row)


@router.get("/auth/me")
async def me(request: Request) -> dict:
    user = await require(request)
    return {key: user[key] for key in ("login", "role", "name", "astronaut_id")}


@router.get("/accounts")
async def accounts(request: Request) -> list[dict]:
    user = await require(request)
    if user["role"] != "chief":
        raise HTTPException(403, "Список акаунтів бачить тільки головний лікар")
    cx = await connect()
    try:
        rows = await (await cx.execute("SELECT id, login, role, name, astronaut_id FROM users ORDER BY id")).fetchall()
    finally:
        await cx.close()
    return [dict(row) for row in rows]


@router.post("/accounts")
async def create_account(body: AccountIn, request: Request) -> dict:
    user = await require(request)
    if user["role"] != "chief":
        raise HTTPException(403, "Акаунт створює тільки головний лікар")
    if body.role not in {"chief", "doctor", "officer", "astronaut"}:
        raise HTTPException(400, "Роль: chief, doctor, officer або astronaut")
    astronaut_id = body.astronaut_id
    if body.role == "astronaut" and not astronaut_id:
        taken = set(request.app.state.astronaut_ids)
        number = 1
        while f"A{number}" in taken:
            number += 1
        astronaut_id = f"A{number}"
    cx = await connect()
    try:
        exists = await (await cx.execute("SELECT 1 FROM users WHERE login=?", (body.login,))).fetchone()
        if exists:
            raise HTTPException(409, "Такий логін уже є")
        await cx.execute(
            "INSERT INTO users(login, password_hash, role, name, astronaut_id) VALUES(?, '', ?, ?, ?)",
            (body.login, body.role, body.name, astronaut_id if body.role == "astronaut" else None),
        )
        if body.role == "astronaut":
            for sensor, (low, high) in PROVISIONAL.items():
                await cx.execute(
                    "INSERT OR IGNORE INTO limits(astronaut_id, sensor_id, min_value, max_value) VALUES(?, ?, ?, ?)",
                    (astronaut_id, sensor, low, high),
                )
            request.app.state.limits.update(
                {(astronaut_id, sensor): pair for sensor, pair in PROVISIONAL.items()}
            )
        await cx.commit()
    finally:
        await cx.close()
    if body.role == "astronaut" and astronaut_id not in request.app.state.astronaut_ids:
        request.app.state.astronaut_ids.append(astronaut_id)
        request.app.state.crew.append({"id": astronaut_id, "name": body.name, "role": "Космонавт"})
    return {"login": body.login, "role": body.role, "astronaut_id": astronaut_id if body.role == "astronaut" else None}


@router.get("/limits")
async def limits(request: Request, astronaut_id: str | None = None) -> list[dict]:
    user = await require(request)
    if user["role"] == "astronaut":
        astronaut_id = user["astronaut_id"]
    cx = await connect()
    try:
        if astronaut_id:
            rows = await (
                await cx.execute(
                    "SELECT astronaut_id, sensor_id, min_value, max_value FROM limits WHERE astronaut_id=? ORDER BY sensor_id",
                    (astronaut_id,),
                )
            ).fetchall()
        else:
            rows = await (
                await cx.execute("SELECT astronaut_id, sensor_id, min_value, max_value FROM limits ORDER BY astronaut_id, sensor_id")
            ).fetchall()
    finally:
        await cx.close()
    from access import sensors_for

    allowed = sensors_for(user["role"])
    return [
        {"astronaut_id": row["astronaut_id"], "sensor_id": row["sensor_id"], "min": row["min_value"], "max": row["max_value"]}
        for row in rows
        if row["sensor_id"] in allowed
    ]


@router.put("/limits")
async def set_limit(body: LimitIn, request: Request) -> dict:
    user = await require(request)
    if user["role"] not in CLINICAL:
        raise HTTPException(403, "Межі ставить лікар")
    guard_astronaut(user, body.astronaut_id, request.app.state.astronaut_ids)
    from access import guard_sensor

    guard_sensor(user, body.sensor_id)
    if body.min is None or body.max is None or body.min >= body.max:
        raise HTTPException(400, "Потрібні min і max, і min менший за max")
    old = request.app.state.limits.get((body.astronaut_id, body.sensor_id))
    ts = now()
    cx = await connect()
    try:
        await cx.execute(
            """INSERT INTO limits(astronaut_id, sensor_id, min_value, max_value) VALUES(?, ?, ?, ?)
               ON CONFLICT(astronaut_id, sensor_id) DO UPDATE SET min_value=excluded.min_value, max_value=excluded.max_value""",
            (body.astronaut_id, body.sensor_id, body.min, body.max),
        )
        old_min = None if old is None else old[0]
        old_max = None if old is None else old[1]
        await write_revision(
            cx,
            user,
            body.astronaut_id,
            [(body.sensor_id, "min", old_min, body.min), (body.sensor_id, "max", old_max, body.max)],
            body.note,
            ts,
        )
        await cx.commit()
    finally:
        await cx.close()
    request.app.state.limits[(body.astronaut_id, body.sensor_id)] = (body.min, body.max)
    return {"astronaut_id": body.astronaut_id, "sensor_id": body.sensor_id, "min": body.min, "max": body.max}


@router.get("/changes")
async def changes(request: Request, astronaut_id: str | None = None) -> list[dict]:
    user = await require(request)
    if user["role"] not in CLINICAL:
        raise HTTPException(403, "Журнал змін бачить лікар")
    cx = await connect()
    try:
        if astronaut_id:
            rows = await (
                await cx.execute(
                    """SELECT id, rev, ts, actor_login, role, astronaut_id, sensor_id, field, old_value, new_value, note
                       FROM changes WHERE astronaut_id=? ORDER BY id DESC LIMIT 200""",
                    (astronaut_id,),
                )
            ).fetchall()
        else:
            rows = await (
                await cx.execute(
                    """SELECT id, rev, ts, actor_login, role, astronaut_id, sensor_id, field, old_value, new_value, note
                       FROM changes ORDER BY id DESC LIMIT 200"""
                )
            ).fetchall()
    finally:
        await cx.close()
    return _revisions(rows)


def _revisions(rows) -> list[dict]:
    order: list[int] = []
    bucket: dict[int, dict] = {}
    for row in rows:
        key = row["rev"] or row["id"]
        item = bucket.get(key)
        if item is None:
            item = {
                "id": key,
                "ts": row["ts"],
                "actor_login": row["actor_login"],
                "role": row["role"],
                "astronaut_id": row["astronaut_id"],
                "note": row["note"],
                "diff": [],
            }
            bucket[key] = item
            order.append(key)
        item["diff"].append(
            {"sensor_id": row["sensor_id"], "field": row["field"], "from": row["old_value"], "to": row["new_value"]}
        )
    for item in bucket.values():
        item["diff"].reverse()
    return [bucket[key] for key in order]
