from clock import now
from models import Reading


def sleep(astronaut_id: str, hours: float, quality: float) -> list[Reading]:
    # Reject empty / placeholder zeros — that is "not submitted", not a clinical report.
    hours = float(hours)
    quality = float(quality)
    if hours <= 0 or quality <= 0:
        raise ValueError("Заповніть години сну та якість (більше 0)")
    ts = now()
    return [
        Reading(sensor_id="sleep_hours", astronaut_id=astronaut_id, value=hours, unit="h", ts=ts, source="form"),
        Reading(sensor_id="sleep_quality", astronaut_id=astronaut_id, value=quality, unit="1-10", ts=ts, source="form"),
    ]


def wellbeing(astronaut_id: str, score: float, comfort: float | None) -> list[Reading]:
    # comfort is accepted by the form and not scored: there is no comfort metric.
    del comfort
    score = float(score)
    if score <= 0:
        raise ValueError("Оцініть самопочуття (більше 0)")
    return [Reading(sensor_id="wellbeing", astronaut_id=astronaut_id, value=score, unit="1-10", ts=now(), source="form")]


def psych(astronaut_id: str, answers: list[float]) -> list[Reading]:
    # Four windows × 0..5 = max 20. Do NOT pad missing answers with 0 — that looked like a crisis.
    if len(answers) < 4:
        raise ValueError("Пройдіть усі 4 пункти анкети")
    clipped = [max(0.0, min(5.0, float(item))) for item in answers[:4]]
    if any(item != item for item in clipped):  # NaN
        raise ValueError("Пройдіть усі 4 пункти анкети")
    # All-zero submission = skipped form, not a scored depression event.
    if sum(clipped) <= 0:
        raise ValueError("Анкета порожня — дайте відповіді перед збереженням")
    total = float(sum(clipped))
    percent = 100.0 * total / 20.0
    ts = now()
    return [
        Reading(sensor_id="mh_score", astronaut_id=astronaut_id, value=total, unit="0-20", ts=ts, source="form"),
        Reading(sensor_id="psych_score", astronaut_id=astronaut_id, value=percent, unit="0-100", ts=ts, source="form"),
    ]


def pvt(astronaut_id: str, times: list[float]) -> list[Reading]:
    ordered = sorted(times)
    mid = ordered[len(ordered) // 2] if ordered else 0.0
    if len(ordered) % 2 == 0 and ordered:
        mid = (ordered[len(ordered) // 2 - 1] + ordered[len(ordered) // 2]) / 2
    lapses = sum(1 for item in times if item > 500)
    ts = now()
    return [
        Reading(sensor_id="pvt_rt_median", astronaut_id=astronaut_id, value=mid, unit="ms", ts=ts, source="form"),
        Reading(sensor_id="pvt_lapses", astronaut_id=astronaut_id, value=lapses, unit="count", ts=ts, source="form"),
    ]


def vision(astronaut_id: str, score: float) -> list[Reading]:
    return [Reading(sensor_id="vision_score", astronaut_id=astronaut_id, value=score, unit="0-100", ts=now(), source="form")]
