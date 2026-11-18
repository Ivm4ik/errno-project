"""Who can see which group. Exact min/max numbers are provisional until replaced."""

import secrets

from fastapi import HTTPException, Request

from db import connect

# Astronaut sees these groups. Officer is also crew: same groups for self; others only via break-glass.
# Doctor and the chief doctor see every group below.
GROUPS = (
    {"id": "activity", "title": "Активність", "astronaut": True, "sensors": ("activity",)},
    {"id": "sleep", "title": "Режим і якість сну", "astronaut": True, "sensors": ("sleep_hours", "sleep_efficiency", "sleep_awakenings", "sleep_waso", "sleep_quality")},
    {"id": "vitals", "title": "Тиск, пульс, кисень", "astronaut": True, "sensors": ("hr", "ecg", "bp_sys", "bp_dia", "spo2")},
    {"id": "breathing", "title": "Дихання", "astronaut": True, "sensors": ("resp",)},
    {"id": "temperature", "title": "Температура тіла", "astronaut": True, "sensors": ("temp",)},
    {"id": "psych", "title": "Психологічний стан", "astronaut": True, "sensors": ("psych_score", "mh_score")},
    {"id": "immunity", "title": "Імунітет", "astronaut": True, "sensors": ("wbc", "hematocrit")},
    {"id": "msk", "title": "М'язи та кістки (УЗД)", "astronaut": True, "sensors": ("ultrasound",)},
    {"id": "wellbeing", "title": "Загальне самопочуття", "astronaut": True, "sensors": ("wellbeing",)},
    {"id": "recovery", "title": "Відновлення після навантаження", "astronaut": True, "sensors": ("lactate",)},
    {"id": "atmosphere", "title": "Атмосфера", "astronaut": True, "sensors": ("co2",)},
    {"id": "labs", "title": "Аналізи крові і сечі", "astronaut": False, "sensors": ("na", "k", "ca", "creatinine")},
    {"id": "mental", "title": "Психічний стан", "astronaut": False, "sensors": ("pvt_rt_median", "pvt_lapses", "vision_score")},
    {"id": "glucose", "title": "Рівень цукру в крові", "astronaut": False, "sensors": ("glucose",)},
    {"id": "icp", "title": "Внутрішньочерепний тиск", "astronaut": False, "sensors": ("icp",)},
    {"id": "eeg", "title": "ЕКГ мозку", "astronaut": False, "sensors": ("eeg", "eeg_alpha", "eeg_theta", "eeg_beta")},
    {"id": "chem", "title": "Підшкірні хімічні датчики", "astronaut": False, "sensors": ("cortisol",)},
    {"id": "radiation", "title": "Радіація", "astronaut": False, "sensors": ("radiation_dose_rate", "radiation_career")},
)

# Temporary bounds so alerts work before the real defaults arrive.
PROVISIONAL = {
    "activity": (50, 800),
    "sleep_hours": (7, 9),
    "sleep_efficiency": (90, 100),
    "sleep_awakenings": (0, 2),
    "sleep_waso": (0, 20),
    # Form and generator use 0–10; older 1–5 bounds false-alarmed every healthy night.
    "sleep_quality": (6, 10),
    "mh_score": (13.2, 20),
    "hr": (50, 100),
    "ecg": (-2.5, 2.5),
    "bp_sys": (90, 120),
    "bp_dia": (60, 80),
    "spo2": (95, 100),
    "resp": (12, 20),
    "temp": (36.1, 37.2),
    "psych_score": (60, 100),
    "wbc": (4, 10),
    "hematocrit": (36, 48),
    "ultrasound": (80, 100),
    "wellbeing": (6, 10),
    "na": (135, 145),
    "k": (3.5, 5.1),
    "creatinine": (50, 110),
    "pvt_rt_median": (180, 300),
    "pvt_lapses": (0, 2),
    "vision_score": (70, 100),
    # Converted once from mmol/L: 3.9 * 18 = 70.2, 6.0 * 18 = 108. Canonical unit is mg/dL.
    "glucose": (70.2, 108.0),
    "icp": (7, 15),
    "lactate": (0.5, 2.2),
    "ca": (8.5, 10.2),
    "co2": (0.0, 0.5),
    "eeg": (0, 40),
    "radiation_dose_rate": (0.0, 0.5),
}

SENSOR_GROUP = {sensor: group["title"] for group in GROUPS for sensor in group["sensors"]}
ASTRONAUT_SENSORS = {sensor for group in GROUPS if group["astronaut"] for sensor in group["sensors"]}
DOCTOR_SENSORS = {sensor for group in GROUPS for sensor in group["sensors"]}
CLINICAL = {"doctor", "chief"}


def sensors_for(role: str, break_glass: bool = False) -> set[str]:
    if role in CLINICAL or break_glass:
        return set(DOCTOR_SENSORS)
    return set(ASTRONAUT_SENSORS)


def out_of_range(value: float | None, bounds: tuple[float, float] | None) -> bool:
    if value is None or bounds is None:
        return False
    low, high = bounds
    return value < low or value > high


def bounds_for(limits: dict, astronaut_id: str, sensor_id: str):
    return limits.get((astronaut_id, sensor_id))


async def require(request: Request) -> dict:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(401, "Потрібен вхід: Authorization: Bearer <token>")
    token = header.split(" ", 1)[1].strip()
    cx = await connect()
    try:
        row = await (
            await cx.execute(
                """SELECT u.id, u.login, u.role, u.name, u.astronaut_id
                   FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token=?""",
                (token,),
            )
        ).fetchone()
    finally:
        await cx.close()
    if row is None:
        raise HTTPException(401, "Сесія недійсна")
    return dict(row)


def guard_sensor(user: dict, sensor_id: str) -> None:
    if sensor_id not in sensors_for(user["role"]):
        raise HTTPException(403, "Ця група показників недоступна для цієї ролі")


def guard_astronaut(user: dict, astronaut_id: str, known: list[str]) -> None:
    if user["role"] == "astronaut" and astronaut_id != user["astronaut_id"]:
        raise HTTPException(403, "Космонавт бачить тільки свої дані")
    if astronaut_id not in known:
        raise HTTPException(404, "Немає такого космонавта")


async def seed_accounts(cx, astronaut_ids: list[str]) -> None:
    """Create default users once, then keep officer/astronaut linked to crew ids."""
    a1 = "A1" if "A1" in astronaut_ids else (astronaut_ids[0] if astronaut_ids else "A1")
    a2 = "A2" if "A2" in astronaut_ids else None
    count = await (await cx.execute("SELECT COUNT(*) AS n FROM users")).fetchone()
    if not count["n"]:
        people = (
            ("doctor", "chief", "Головний лікар", None),
            ("officer", "officer", "Тарас Бондар", a2),
            ("astronaut", "astronaut", "Олена Кравець", a1),
        )
        for login, role, name, astronaut_id in people:
            await cx.execute(
                "INSERT INTO users(login, password_hash, role, name, astronaut_id) VALUES(?, '', ?, ?, ?)",
                (login, role, name, astronaut_id),
            )
    # Officer is also expedition crew (A2). Repair older DBs that seeded without the link.
    if a2:
        await cx.execute(
            "UPDATE users SET astronaut_id=?, name=COALESCE(NULLIF(name, ''), ?) WHERE login='officer' AND role='officer' AND (astronaut_id IS NULL OR astronaut_id='')",
            (a2, "Тарас Бондар"),
        )
    if a1:
        await cx.execute(
            "UPDATE users SET astronaut_id=? WHERE login='astronaut' AND role='astronaut' AND (astronaut_id IS NULL OR astronaut_id='')",
            (a1,),
        )
    for astronaut_id in astronaut_ids:
        for sensor, (low, high) in PROVISIONAL.items():
            exists = await (
                await cx.execute(
                    "SELECT 1 AS ok FROM limits WHERE astronaut_id=? AND sensor_id=?",
                    (astronaut_id, sensor),
                )
            ).fetchone()
            if exists:
                continue
            await cx.execute(
                "INSERT INTO limits(astronaut_id, sensor_id, min_value, max_value) VALUES(?, ?, ?, ?)",
                (astronaut_id, sensor, low, high),
            )
    # Old DBs kept mmol/L glucose (3.9–6) and 1–5 sleep quality while live units are mg/dL and 0–10.
    for astronaut_id in astronaut_ids:
        await cx.execute(
            "UPDATE limits SET min_value=?, max_value=? WHERE astronaut_id=? AND sensor_id='glucose' AND max_value <= 20",
            (*PROVISIONAL["glucose"], astronaut_id),
        )
        await cx.execute(
            "UPDATE limits SET min_value=?, max_value=? WHERE astronaut_id=? AND sensor_id='sleep_quality' AND max_value <= 5",
            (*PROVISIONAL["sleep_quality"], astronaut_id),
        )
    await cx.commit()


async def load_limits(cx) -> dict[tuple[str, str], tuple[float, float]]:
    rows = await (await cx.execute("SELECT astronaut_id, sensor_id, min_value, max_value FROM limits")).fetchall()
    return {(row["astronaut_id"], row["sensor_id"]): (row["min_value"], row["max_value"]) for row in rows}


async def write_revision(cx, user: dict, astronaut_id: str, diffs: list[tuple], note: str | None, ts: float) -> int:
    kept = [(sensor, field, old, new) for sensor, field, old, new in diffs if old != new]
    if not kept:
        return 0
    rev = None
    for sensor, field, old, new in kept:
        cur = await cx.execute(
            """INSERT INTO changes(rev, ts, actor_id, actor_login, role, astronaut_id, sensor_id, field, old_value, new_value, note)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (rev, ts, user["id"], user["login"], user["role"], astronaut_id, sensor, field, old, new, note),
        )
        if rev is None:
            rev = cur.lastrowid
            await cx.execute("UPDATE changes SET rev=? WHERE id=?", (rev, rev))
    return rev or 0


def new_token() -> str:
    return secrets.token_urlsafe(32)
