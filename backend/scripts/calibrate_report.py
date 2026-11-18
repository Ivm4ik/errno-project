"""Compare zone edges with the penalty model. Prints mismatches. Does not change numbers."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from config_loader import load_yaml
from scoring.penalty import compute
from scoring.rules import load_rules
from zones import zone

# Edge values that the zone function classifies. Glucose is already mg/dL.
EDGES = {
    "hr": {"yellow": [50, 59, 101, 120], "red": [49.9, 120.1]},
    "resp": {"yellow": [10, 11, 21, 24], "red": [9.9, 24.1]},
    "spo2": {"yellow": [91, 94], "red": [90]},
    "bp_sys": {"yellow": [121, 139], "red": [89.9, 140]},
    "temp": {"yellow": [35.5, 36.0, 37.3, 37.9], "red": [35.4, 38]},
    "eeg": {"yellow": [41, 70], "red": [70.1]},
    "glucose": {"yellow": [55, 69, 100, 125], "red": [54.9, 125.1]},
    "k": {"yellow": [3.2, 3.4, 5.1, 5.4], "red": [3.19, 5.5]},
    "na": {"yellow": [130, 134, 146, 150], "red": [129.9, 150.1]},
    "ca": {"yellow": [8.1, 8.4, 10.3, 10.8], "red": [8.0, 10.81]},
    "lactate": {"yellow": [2.3, 3.9], "red": [4]},
    "icp": {"yellow": [16, 20], "red": [20.1]},
    "sleep_hours": {"yellow": [5.0, 6.4], "red": [4.9]},
    "radiation_dose_rate": {"yellow": [0.5, 1.5], "red": [1.51]},
    "co2": {"yellow": [0.5, 1.0], "red": [1.01]},
}


def main() -> None:
    rules = load_rules()
    cfg = load_yaml("penalty.yaml")
    status = load_yaml("status.yaml")
    single = float(status["T_SINGLE"])
    crit = float(status["T_CRIT"])
    canonical = {rule.metric: rule for rule in rules}
    sensor_of = {
        "HR": "hr", "RR": "resp", "SPO2": "spo2", "BP": "bp_sys", "TEMP": "temp", "EEG": "eeg",
        "GLU": "glucose", "K": "k", "NA": "na", "CA": "ca", "LAC": "lactate", "ICP": "icp",
        "SLP_DUR": "sleep_hours", "SLP_EFF": "sleep_efficiency", "SLP_AWK": "sleep_awakenings",
        "SLP_WASO": "sleep_waso", "SLP_QUAL": "sleep_quality", "MH_SCORE": "mh_score",
        "RAD": "radiation_dose_rate", "CO2": "co2",
    }
    mismatches = []
    for astronaut in ("A1", "A2"):
        for metric, sensor in sensor_of.items():
            for band, values in EDGES[sensor].items():
                for value in values:
                    seen = zone(sensor, value)
                    if seen != band:
                        mismatches.append(f"{astronaut} {metric} {value} expected {band} zone()={seen}")
                        continue
                    scored = compute(astronaut, {metric: {"value": value, "ts": 0, "usable": True}}, "rest", 0, rules, cfg)
                    penalty = next(row["penalty"] for row in scored["rows"] if row["metric"] == metric)
                    if band == "red" and penalty < single:
                        mismatches.append(f"{astronaut} {metric}={value} red P={penalty:.2f} < T_SINGLE {single:g}")
                    if band == "yellow" and penalty >= crit:
                        mismatches.append(f"{astronaut} {metric}={value} yellow P={penalty:.2f} >= T_CRIT {crit:g} (S for one metric)")
    print(f"rules={len(canonical)} T_SINGLE={single:g} T_CRIT={crit:g}")
    if not mismatches:
        print("no mismatches")
    for line in mismatches:
        print(line)
    print(f"count={len(mismatches)}")


if __name__ == "__main__":
    main()
