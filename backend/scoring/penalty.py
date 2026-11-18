"""Penalty sum. Status uses this, not the zone colour.

# TODO: mentor formula was not preserved. See config/penalty.yaml.
# Physical + mental: same Pi = k * max(0, |X-N| - delta), with optional directional gate.
#
# Fault tolerance: classify_sensor() runs before Pi.
# SIGNAL_LOST / SENSOR_ANOMALY → penalty=0 (channel dropped from Health Score)
# so a dead / contradictory sensor cannot raise critical / Break-Glass.
"""

from scoring.rules import Rule
from scoring.validate import FORM_PENDING, SENSOR_ANOMALY, classify_sensor, is_fault, validate_sensor_data


def compute(astronaut_id: str, samples: dict, activity: str, now: float, rules: list[Rule], cfg: dict) -> dict:
    """samples[metric] = {value, ts, usable, plausible?}. Missing key means no sample yet."""
    low = set(cfg["one_sided_low"])
    high = set(cfg["one_sided_high"])
    rare = set(cfg["rare"])
    stale_after = cfg["stale_after"]
    exercise = set(cfg["exercise_zero"])

    # Peer map for Sensor Fusion (legacy metric codes used by rules).
    peers = {
        metric: slot.get("value")
        for metric, slot in samples.items()
        if slot is not None and slot.get("value") is not None
    }

    rows = []
    for rule in rules:
        slot = samples.get(rule.metric)
        base = rule.baseline(astronaut_id)
        sided = rule.condition in {"low", "high"} or rule.metric in low or rule.metric in high
        row = {
            "metric": rule.metric,
            "value": None if slot is None else slot.get("value"),
            "baseline": base,
            "deviation": 0.0,
            "penalty": 0.0,
            "one_sided": sided,
            "suppressed_by_fusion": False,
            "stale": False,
            "signal_lost": False,
            "sensor_anomaly": False,
            "form_pending": False,
            "anomaly_kind": None,
            "condition": rule.condition,
        }
        if slot is None:
            row["stale"] = rule.metric in rare
            row["form_pending"] = rule.metric in rare and rule.metric.startswith(("SLP", "MH"))
            rows.append(row)
            continue
        if rule.metric in rare and slot.get("ts") is not None and now - float(slot["ts"]) > float(stale_after.get(rule.metric, 0)):
            row["stale"] = True
            rows.append(row)
            continue

        # --- Sanity + Cross-Validation (Graceful Degradation) ---
        plausible = slot.get("plausible")
        status = classify_sensor(rule.metric, slot.get("value"), plausible, peers)
        if status == FORM_PENDING:
            # Not submitted ≠ sensor fault ≠ medical crisis. No penalty, no Break-Glass.
            row["stale"] = True
            row["form_pending"] = True
            row["penalty"] = 0.0
            rows.append(row)
            continue
        if is_fault(status):
            # Isolation flag: equipment fault never feeds Health Score / Break-Glass.
            row["signal_lost"] = True
            row["sensor_anomaly"] = status == SENSOR_ANOMALY
            single = validate_sensor_data(rule.metric, slot.get("value"), plausible)
            if status == SENSOR_ANOMALY and single == "OK":
                kind = "fusion"
            elif status == SENSOR_ANOMALY:
                kind = "bounds"
            else:
                kind = "lost"
            row["anomaly_kind"] = kind
            row["penalty"] = 0.0
            if kind == "fusion":
                row["suppressed_by_fusion"] = True
            rows.append(row)
            continue

        if not slot.get("usable", True):
            row["signal_lost"] = True
            row["anomaly_kind"] = "lost"
            rows.append(row)
            continue
        value = float(slot["value"])
        row["value"] = value
        if activity == "exercise" and rule.metric in exercise:
            row["suppressed_by_fusion"] = True
            rows.append(row)
            continue

        condition = rule.condition
        if condition is None:
            if rule.metric in low:
                condition = "low"
            elif rule.metric in high:
                condition = "high"

        if condition == "low" and value >= base:
            rows.append(row)
            continue
        if condition == "high" and value <= base:
            rows.append(row)
            continue

        deviation = abs(value - base)
        row["deviation"] = deviation
        if deviation > rule.delta:
            row["penalty"] = rule.k * (deviation - rule.delta)
        rows.append(row)

    total = sum(item["penalty"] for item in rows)
    return {
        "rows": rows,
        "total": total,
        "max_penalty": max((item["penalty"] for item in rows), default=0.0),
        "health_index": max(0.0, 100.0 - total),
        "signal_lost_count": sum(1 for item in rows if item.get("signal_lost")),
        "sensor_anomaly_count": sum(1 for item in rows if item.get("sensor_anomaly")),
    }
