"""Sensor Sanity + Cross-Validation — Fault Tolerance / Graceful Degradation.

Equipment faults are SENSOR_ANOMALY / SIGNAL_LOST, never a clinical crisis.
Downstream penalty math must treat both as penalty=0 so a dead bracelet cannot
flip Health Score / Break-Glass (false alarm).
"""

from __future__ import annotations

from typing import Any, Mapping

SIGNAL_OK = "OK"
SIGNAL_LOST = "SIGNAL_LOST"  # missing / 0 / NaN — no usable sample
SENSOR_ANOMALY = "SENSOR_ANOMALY"  # out of survival OR fusion contradiction
FORM_PENDING = "FORM_PENDING"  # sleep/psych not submitted — not a crisis, not a dead sensor

# Questionnaire / daily form metrics: 0 or empty means "not filled in", never clinical death.
_FORM_EMPTY_ZERO = {
    "SLP_DUR",
    "sleep_hours",
    "SLP_QUAL",
    "sleep_quality",
    "SLP_EFF",
    "sleep_efficiency",
    "MH_SCORE",
    "mh_score",
    "psych_score",
    "wellbeing",
    "WELL",
}

# Absolute survival envelopes (user/demo bounds). Catalog + legacy keys.
_SURVIVAL: dict[str, tuple[float, float]] = {
    "HR": (25, 240),
    "hr": (25, 240),
    "TEMP": (32.0, 43.0),
    "temp": (32.0, 43.0),
    "RR": (4, 60),
    "resp": (4, 60),
    "SPO2": (50, 100),
    "spo2": (50, 100),
    "BP": (40, 260),
    "bp_sys": (40, 260),
    "BPD": (30, 150),
    "bp_dia": (30, 150),
    "GLU": (18, 540),
    "glucose": (18, 540),
    "LAC": (0, 20),
    "lactate": (0, 20),
    "ICP": (0, 40),
    "icp": (0, 40),
    "K": (1, 9),
    "k": (1, 9),
    "NA": (100, 180),
    "na": (100, 180),
    "CA": (4, 16),
    "ca": (4, 16),
    "CO2": (0, 10),
    "co2": (0, 10),
    "EEG": (0, 100),
    "eeg": (0, 100),
    "RAD": (0, 50),
    "radiation_dose_rate": (0, 50),
}

# Hard zero on these = dropout (N/A), not a living vital of 0.
_ZERO_MEANS_LOST = {
    "hr", "HR", "spo2", "SPO2", "resp", "RR",
    "bp_sys", "BP", "bp_dia", "BPD", "temp", "TEMP",
}

# Continuous vitals used for Sensor Fusion cross-check (catalog + legacy).
_FUSION_PEERS = {
    "hr", "HR", "spo2", "SPO2", "resp", "RR",
    "bp_sys", "BP", "bp_dia", "BPD", "temp", "TEMP",
}

# Green "adjacent are fine" bands for fusion (not clinical red/yellow).
_GREEN: dict[str, tuple[float, float]] = {
    "HR": (60, 100), "hr": (60, 100),
    "SPO2": (95, 100), "spo2": (95, 100),
    "BP": (90, 120), "bp_sys": (90, 120),
    "BPD": (60, 80), "bp_dia": (60, 80),
    "RR": (12, 20), "resp": (12, 20),
    "TEMP": (36.1, 37.2), "temp": (36.1, 37.2),
}

# Clinical extremes that look like death / hardware spike when peers are green.
_EXTREME: dict[str, tuple[float, float]] = {
    # outside → extreme (stricter than yellow, roughly clinical red)
    "HR": (50, 160), "hr": (50, 160),
    "SPO2": (90, 100), "spo2": (90, 100),  # <=90 extreme
    "BP": (85, 160), "bp_sys": (85, 160),
    "BPD": (45, 100), "bp_dia": (45, 100),
    "RR": (8, 28), "resp": (8, 28),
    "TEMP": (35.0, 39.0), "temp": (35.0, 39.0),
}


def is_fault(status: str) -> bool:
    return status in {SIGNAL_LOST, SENSOR_ANOMALY}


def is_form_pending(metric: str, value: Any) -> bool:
    """True when a daily form was never meaningfully submitted (empty / zero)."""
    if metric not in _FORM_EMPTY_ZERO:
        return False
    if value is None:
        return True
    try:
        number = float(value)
    except (TypeError, ValueError):
        return True
    if number != number:
        return True
    return number <= 0


def validate_sensor_data(
    metric: str,
    value: Any,
    plausible: tuple[float, float] | list[float] | None = None,
) -> str:
    """Single-channel sanity (no peers). OK | LOST | ANOMALY | FORM_PENDING."""
    # ponytail: forms are not transducers — empty sleep/psych must not open Break-Glass.
    if is_form_pending(metric, value):
        return FORM_PENDING
    if value is None:
        return SIGNAL_LOST
    try:
        number = float(value)
    except (TypeError, ValueError):
        return SIGNAL_LOST
    if number != number:  # NaN
        return SIGNAL_LOST
    if number == 0 and metric in _ZERO_MEANS_LOST:
        return SIGNAL_LOST

    bounds = None
    if plausible is not None and len(plausible) == 2:
        bounds = (float(plausible[0]), float(plausible[1]))
    else:
        bounds = _SURVIVAL.get(metric)

    if bounds is not None:
        lo, hi = bounds
        if number < lo or number > hi:
            return SENSOR_ANOMALY
    return SIGNAL_OK


def is_clinical_extreme(metric: str, value: float) -> bool:
    band = _EXTREME.get(metric)
    if band is None:
        return False
    lo, hi = band
    # SpO2: only low side is extreme
    if metric in {"spo2", "SPO2"}:
        return value <= lo
    return value < lo or value > hi


def is_green_vital(metric: str, value: float) -> bool:
    band = _GREEN.get(metric)
    if band is None:
        return False
    lo, hi = band
    return lo <= value <= hi


def fusion_anomaly(metric: str, value: float, peers: Mapping[str, Any] | None) -> bool:
    """True when this extreme channel contradicts green adjacent vitals → sensor fault."""
    if peers is None or metric not in _FUSION_PEERS:
        return False
    if not is_clinical_extreme(metric, value):
        return False
    green_peers = 0
    for key, raw in peers.items():
        if key == metric or key not in _FUSION_PEERS or raw is None:
            continue
        try:
            number = float(raw)
        except (TypeError, ValueError):
            continue
        if number != number:
            continue
        # Witness must itself be sane and green — otherwise this may be a real multi-vital crisis.
        if validate_sensor_data(key, number) != SIGNAL_OK:
            continue
        if is_clinical_extreme(key, number):
            return False
        if not is_green_vital(key, number):
            return False
        green_peers += 1
    # Need ≥2 healthy green neighbours to blame the transducer over the patient.
    return green_peers >= 2


def classify_sensor(
    metric: str,
    value: Any,
    plausible: tuple[float, float] | list[float] | None = None,
    peers: Mapping[str, Any] | None = None,
) -> str:
    """Full gate: form empty → PENDING, missing → LOST, bounds/fusion → ANOMALY."""
    status = validate_sensor_data(metric, value, plausible)
    if status != SIGNAL_OK:
        return status
    try:
        number = float(value)
    except (TypeError, ValueError):
        return SIGNAL_LOST
    if fusion_anomaly(metric, number, peers):
        return SENSOR_ANOMALY
    return SIGNAL_OK


def anomaly_kind(status: str) -> str | None:
    if status == SIGNAL_LOST:
        return "lost"
    if status == SENSOR_ANOMALY:
        return "bounds"  # caller may overwrite with "fusion"
    return None


def is_signal_lost(
    metric: str,
    value: Any,
    plausible: tuple[float, float] | list[float] | None = None,
) -> bool:
    """Backward-compatible: any equipment fault that must not score clinically."""
    return is_fault(validate_sensor_data(metric, value, plausible))
