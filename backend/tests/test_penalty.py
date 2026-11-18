from config_loader import load_yaml
from scoring.penalty import compute
from scoring.rules import load_rules

RULES = load_rules()
CFG = load_yaml("penalty.yaml")


def _sample(metric: str, value: float, ts: float = 0) -> dict:
    return {metric: {"value": value, "ts": ts, "usable": True}}


def test_inside_delta_is_zero_and_health_is_100():
    scored = compute("A1", _sample("HR", 80), "rest", 10, RULES, CFG)
    hr = next(row for row in scored["rows"] if row["metric"] == "HR")
    assert hr["penalty"] == 0
    assert scored["health_index"] == 100


def test_exercise_zeros_hr_rr_lac_only():
    samples = {"HR": {"value": 160, "ts": 1, "usable": True}, "TEMP": {"value": 39, "ts": 1, "usable": True}}
    moving = compute("A1", samples, "exercise", 1, RULES, CFG)
    still = compute("A1", samples, "rest", 1, RULES, CFG)
    hr = next(row for row in moving["rows"] if row["metric"] == "HR")
    assert hr["penalty"] == 0 and hr["suppressed_by_fusion"] is True
    assert next(row for row in still["rows"] if row["metric"] == "HR")["penalty"] > 35
    assert next(row for row in moving["rows"] if row["metric"] == "TEMP")["penalty"] > 0


def test_one_sided_and_bad_quality_and_stale():
    high_spo2 = compute("A1", _sample("SPO2", 100), "rest", 1, RULES, CFG)
    assert next(row for row in high_spo2["rows"] if row["metric"] == "SPO2")["penalty"] == 0
    low_spo2 = compute("A1", _sample("SPO2", 85), "rest", 1, RULES, CFG)
    assert next(row for row in low_spo2["rows"] if row["metric"] == "SPO2")["penalty"] > 0
    bad = compute("A1", {"HR": {"value": 180, "ts": 1, "usable": False}}, "rest", 1, RULES, CFG)
    assert next(row for row in bad["rows"] if row["metric"] == "HR")["penalty"] == 0
    stale = compute("A1", {"SLP_DUR": {"value": 2, "ts": 0, "usable": True}}, "rest", 200_000, RULES, CFG)
    row = next(item for item in stale["rows"] if item["metric"] == "SLP_DUR")
    assert row["stale"] is True and row["penalty"] == 0


def test_a1_and_a2_use_different_baselines():
    a1 = compute("A1", _sample("HR", 80), "rest", 1, RULES, CFG)
    a2 = compute("A2", _sample("HR", 80), "rest", 1, RULES, CFG)
    assert next(row for row in a1["rows"] if row["metric"] == "HR")["baseline"] == 80
    assert next(row for row in a2["rows"] if row["metric"] == "HR")["baseline"] == 78


def test_sleep_mental_directional_and_sum_with_physical():
    # Good sleep above baseline → no mental penalty; poor sleep + mild HR → unified total.
    good = compute("A1", _sample("SLP_DUR", 9.0), "rest", 1, RULES, CFG)
    assert next(row for row in good["rows"] if row["metric"] == "SLP_DUR")["penalty"] == 0
    awaken_ok = compute("A1", _sample("SLP_AWK", 0), "rest", 1, RULES, CFG)
    assert next(row for row in awaken_ok["rows"] if row["metric"] == "SLP_AWK")["penalty"] == 0
    awaken_bad = compute("A1", _sample("SLP_AWK", 4), "rest", 1, RULES, CFG)
    assert next(row for row in awaken_bad["rows"] if row["metric"] == "SLP_AWK")["penalty"] > 0
    mixed = compute(
        "A1",
        {
            "HR": {"value": 110, "ts": 1, "usable": True},
            "SLP_DUR": {"value": 5.0, "ts": 1, "usable": True},
            "MH_SCORE": {"value": 10, "ts": 1, "usable": True},
        },
        "rest",
        1,
        RULES,
        CFG,
    )
    assert mixed["total"] == sum(row["penalty"] for row in mixed["rows"])
    assert mixed["total"] > 0
    assert any(row["metric"] == "SLP_DUR" and row["penalty"] > 0 for row in mixed["rows"])
    assert any(row["metric"] == "MH_SCORE" and row["penalty"] > 0 for row in mixed["rows"])
    # 4×5=20, green at >=66% (13.2); 16 is green, 10 is penalty
    green = compute("A1", _sample("MH_SCORE", 16), "rest", 1, RULES, CFG)
    assert next(row for row in green["rows"] if row["metric"] == "MH_SCORE")["penalty"] == 0
