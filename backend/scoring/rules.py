"""Penalty rules adapted from the monitoring sheet. Delimiter is ';'."""

import csv
from dataclasses import dataclass
from pathlib import Path

from config_loader import ROOT

# Ukrainian labels from the sheet, in seconds.
COOLDOWNS = {
    "Миттєво": 0,
    "5 хв": 300,
    "15 сек": 15,
    "24 год": 86400,
    "12 год": 43200,
    "30 хв": 1800,
    "1 хв": 60,
}

# Penalty_Condition from sleep/mental sheet → directional gate.
CONDITIONS = {
    "": None,
    "both": None,
    "low": "low",  # only if X < N
    "high": "high",  # only if X > N
    "Тільки якщо X < N": "low",
    "Тільки якщо X > N": "high",
    "Тільки якщо X < N (5=відмінно, 1=жахливо)": "low",
    "Тільки якщо X < N (макс 25 балів)": "low",
}


@dataclass(frozen=True)
class Rule:
    metric: str
    b1: float
    b2: float
    delta: float
    k: float
    cooldown_s: int
    cooldown_label: str
    hud: str
    cmo: str
    surgeon: str
    # None = both sides; "low" = only below baseline; "high" = only above.
    condition: str | None = None

    def baseline(self, astronaut_id: str) -> float:
        # A2 is Astro2. Everyone else, including a later A3, uses Astro1.
        return self.b2 if astronaut_id == "A2" else self.b1


def _cooldown(label: str, metric: str) -> tuple[int, str]:
    text = (label or "Миттєво").strip()
    if text not in COOLDOWNS:
        raise ValueError(f"unknown cooldown {text!r} for {metric}")
    return COOLDOWNS[text], text


def _condition(raw: str | None) -> str | None:
    key = (raw or "").strip()
    if key not in CONDITIONS:
        # Prefix match for long Ukrainian notes in the brief.
        if key.startswith("Тільки якщо X < N"):
            return "low"
        if key.startswith("Тільки якщо X > N"):
            return "high"
        raise ValueError(f"unknown Penalty_Condition {key!r}")
    return CONDITIONS[key]


def _window(row: dict) -> str:
    return (row.get("Data_Window") or row.get("Cooldown_Window") or "Миттєво") or "Миттєво"


def _hud(row: dict) -> str:
    for key, value in row.items():
        if key and key.startswith("Astronaut_HUD_Msg") and value:
            return value.strip()
    return ""


def _cmo(row: dict) -> str:
    for key, value in row.items():
        if key and key.startswith("CMO_Emergency_Protocol") and value:
            return value.strip()
    return ""


def _load_physical(path: Path) -> list[Rule]:
    out: list[Rule] = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle, delimiter=";"):
            cool_s, cool_label = _cooldown(_window(row), row["Metric"])
            out.append(
                Rule(
                    metric=row["Metric"].strip(),
                    b1=float(row["Baseline_Astro1"]),
                    b2=float(row["Baseline_Astro2"]),
                    delta=float(row["Tolerance_Delta"]),
                    k=float(row["Weight_k"]),
                    cooldown_s=cool_s,
                    cooldown_label=cool_label,
                    hud=_hud(row),
                    cmo=_cmo(row),
                    surgeon=(row.get("Surgeon_Delayed_Payload") or "").strip(),
                    condition=None,
                )
            )
    return out


def _load_mental(path: Path) -> list[Rule]:
    out: list[Rule] = []
    with path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle, delimiter=";"):
            metric = (row.get("Metric_ID") or row.get("Metric") or "").strip()
            cool_s, cool_label = _cooldown(row.get("Data_Window") or row.get("Cooldown_Window") or "24 год", metric)
            out.append(
                Rule(
                    metric=metric,
                    b1=float(row["Baseline_Astro1"]),
                    b2=float(row.get("Baseline_Astro2") or row["Baseline_Astro1"]),
                    delta=float(row["Tolerance_Delta"]),
                    k=float(row["Weight_k"]),
                    cooldown_s=cool_s,
                    cooldown_label=cool_label,
                    hud=_hud(row),
                    cmo=_cmo(row),
                    surgeon=(row.get("Surgeon_Delayed_Payload") or "").strip(),
                    condition=_condition(row.get("Penalty_Condition")),
                )
            )
    return out


def load_rules() -> list[Rule]:
    """Physical telemetry + sleep/mental rules in one evaluation set."""
    physical = ROOT / "config" / "rules_and_messages.csv"
    mental = ROOT / "config" / "sleep_and_mental_rules.csv"
    rules = _load_physical(physical)
    if mental.exists():
        # Mental sheet replaces the coarse SLP row when SLP_DUR is present.
        mental_rules = _load_mental(mental)
        drop = {"SLP"} if any(rule.metric == "SLP_DUR" for rule in mental_rules) else set()
        rules = [rule for rule in rules if rule.metric not in drop]
        rules.extend(mental_rules)
    seen: set[str] = set()
    for rule in rules:
        if rule.metric in seen:
            raise ValueError(f"duplicate metric rule {rule.metric}")
        seen.add(rule.metric)
    return rules
