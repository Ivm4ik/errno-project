from scoring.penalty import compute
from scoring.rules import load_rules
from scoring.validate import (
    FORM_PENDING,
    SENSOR_ANOMALY,
    SIGNAL_LOST,
    SIGNAL_OK,
    classify_sensor,
    validate_sensor_data,
)
from config_loader import load_yaml

RULES = load_rules()
CFG = load_yaml("penalty.yaml")


def test_validate_null_and_nan_are_signal_lost():
    assert validate_sensor_data("hr", None) == SIGNAL_LOST
    assert validate_sensor_data("HR", float("nan")) == SIGNAL_LOST
    assert validate_sensor_data("hr", "nope") == SIGNAL_LOST
    assert validate_sensor_data("hr", 0) == SIGNAL_LOST


def test_validate_survival_envelopes():
    assert validate_sensor_data("hr", 80) == SIGNAL_OK
    assert validate_sensor_data("HR", 10) == SENSOR_ANOMALY  # < 25
    assert validate_sensor_data("hr", 250) == SENSOR_ANOMALY  # > 240
    assert validate_sensor_data("temp", 36.6) == SIGNAL_OK
    assert validate_sensor_data("TEMP", 28) == SENSOR_ANOMALY
    assert validate_sensor_data("temp", 46) == SENSOR_ANOMALY
    assert validate_sensor_data("bp_sys", 30) == SENSOR_ANOMALY  # < 40


def test_validate_respects_plausible_override():
    assert validate_sensor_data("spo2", 40, plausible=(50, 100)) == SENSOR_ANOMALY
    assert validate_sensor_data("spo2", 97, plausible=(50, 100)) == SIGNAL_OK


def test_fusion_extreme_hr_with_green_peers_is_anomaly():
    peers = {"HR": 200, "SPO2": 98, "BP": 110, "BPD": 70, "RR": 16, "TEMP": 36.6}
    assert classify_sensor("HR", 200, peers=peers) == SENSOR_ANOMALY
    # Alone (no peers) — still a clinical value inside survival, OK for single-channel.
    assert validate_sensor_data("HR", 200) == SIGNAL_OK


def test_fusion_real_multi_vital_crisis_stays_clinical():
    # Extreme HR + low SpO2 → do not blame the bracelet.
    peers = {"HR": 200, "SPO2": 82, "BP": 110, "RR": 16, "TEMP": 36.6}
    assert classify_sensor("HR", 200, peers=peers) == SIGNAL_OK


def test_signal_lost_penalty_is_zero_and_health_untouched_by_fault():
    """Dead HR bracelet must not drag Health Score — fusion uses remaining sensors."""
    healthy = compute(
        "A1",
        {"TEMP": {"value": 36.6, "ts": 1, "usable": True}},
        "rest",
        1,
        RULES,
        CFG,
    )
    broken_hr = compute(
        "A1",
        {
            "HR": {"value": 15, "ts": 1, "usable": True},
            "TEMP": {"value": 36.6, "ts": 1, "usable": True},
        },
        "rest",
        1,
        RULES,
        CFG,
    )
    hr = next(row for row in broken_hr["rows"] if row["metric"] == "HR")
    assert hr["signal_lost"] is True
    assert hr["sensor_anomaly"] is True
    assert hr["penalty"] == 0
    assert broken_hr["health_index"] == healthy["health_index"]
    assert broken_hr["total"] == healthy["total"]


def test_fusion_penalty_zero_does_not_open_critical_path():
    scored = compute(
        "A1",
        {
            "HR": {"value": 200, "ts": 1, "usable": True},
            "SPO2": {"value": 98, "ts": 1, "usable": True},
            "BP": {"value": 110, "ts": 1, "usable": True},
            "BPD": {"value": 70, "ts": 1, "usable": True},
            "RR": {"value": 16, "ts": 1, "usable": True},
            "TEMP": {"value": 36.6, "ts": 1, "usable": True},
        },
        "rest",
        1,
        RULES,
        CFG,
    )
    hr = next(row for row in scored["rows"] if row["metric"] == "HR")
    assert hr["anomaly_kind"] == "fusion"
    assert hr["penalty"] == 0
    assert scored["max_penalty"] == 0 or all(
        row["penalty"] == 0 or row["metric"] != "HR" for row in scored["rows"]
    )
    assert hr["penalty"] == 0
    # No HR contribution — index stays high (other metrics nominal).
    assert scored["health_index"] >= 99


def test_clinical_red_still_penalises_valid_extreme():
    """Graceful degradation must not mute a real tachycardia inside the envelope (alone)."""
    scored = compute("A1", {"HR": {"value": 180, "ts": 1, "usable": True}}, "rest", 1, RULES, CFG)
    hr = next(row for row in scored["rows"] if row["metric"] == "HR")
    assert hr["signal_lost"] is False
    assert hr["penalty"] > 0
    assert scored["health_index"] < 100


def test_empty_sleep_form_is_pending_not_critical():
    """Unsubmitted sleep/psych (zeros) must not drag Health Score or look like a dead sensor."""
    assert validate_sensor_data("SLP_DUR", 0) == FORM_PENDING
    assert validate_sensor_data("sleep_hours", 0) == FORM_PENDING
    assert validate_sensor_data("MH_SCORE", 0) == FORM_PENDING
    scored = compute(
        "A1",
        {
            "HR": {"value": 80, "ts": 1, "usable": True},
            "SLP_DUR": {"value": 0, "ts": 1, "usable": True, "plausible": [0.5, 16]},
            "SLP_QUAL": {"value": 0, "ts": 1, "usable": True, "plausible": [1, 10]},
            "MH_SCORE": {"value": 0, "ts": 1, "usable": True, "plausible": [0, 20]},
        },
        "rest",
        1,
        RULES,
        CFG,
    )
    for metric in ("SLP_DUR", "SLP_QUAL", "MH_SCORE"):
        row = next(item for item in scored["rows"] if item["metric"] == metric)
        assert row["form_pending"] is True
        assert row["signal_lost"] is False
        assert row["penalty"] == 0
    assert scored["health_index"] == 100
    assert scored["max_penalty"] == 0


def test_real_bad_sleep_still_penalises():
    scored = compute(
        "A1",
        {"SLP_DUR": {"value": 3, "ts": 1, "usable": True, "plausible": [0.5, 16]}},
        "rest",
        1,
        RULES,
        CFG,
    )
    row = next(item for item in scored["rows"] if item["metric"] == "SLP_DUR")
    assert row["form_pending"] is False
    assert row["penalty"] > 0
    assert scored["health_index"] < 100
