from dataclasses import dataclass, field

from scoring.baseline import update, zscore
from scoring.help_rule import quiet, triggered


@dataclass
class MetricState:
    mean: float = 0.0
    var: float = 0.0
    n: int = 0
    level: str = "ok"
    pend: str = "ok"
    pend_n: int = 0
    since: float | None = None
    bad_since: float | None = None
    equip: bool = False
    last_z: float = 0.0
    last_value: float | None = None
    updated: float = 0.0


@dataclass
class Engine:
    metrics: dict
    scoring: dict
    actions: dict
    states: dict = field(default_factory=dict)
    alerts: list = field(default_factory=list)
    help: dict = field(default_factory=dict)
    _seq: int = 0

    def state(self, astronaut: str, sensor: str) -> MetricState:
        return self.states.setdefault((astronaut, sensor), MetricState())

    def step(self, reading) -> list[dict]:
        metric = self.metrics.get(reading.sensor_id)
        events: list[dict] = []
        if metric is None:
            return events
        now = float(reading.ts)
        st = self.state(reading.astronaut_id, reading.sensor_id)
        st.updated = now
        # Waveform strips (ECG): keep last sample for board "live", skip z-score alerts.
        if metric.get("mode") == "waveform":
            st.last_value = reading.value
            st.n = max(st.n, 1)
            return events
        if reading.quality < 0.5:
            events.extend(self._equipment(reading, metric, st, now))
            self._help(reading.astronaut_id, now, events)
            return events
        st.bad_since = None
        st.equip = False
        alpha = float(self.scoring["ewma_alpha"])
        if st.n < int(self.scoring["warmup_samples"]):
            st.mean, st.var, st.n = update(st.mean, st.var, st.n, reading.value, alpha)
            st.last_value = reading.value
            return events
        level, score_z = self._level(metric, st, reading.value)
        st.mean, st.var, st.n = update(st.mean, st.var, st.n, reading.value, alpha)
        st.last_z = score_z
        st.last_value = reading.value
        if level != st.pend:
            st.pend = level
            st.pend_n = 1
            st.since = now
        else:
            st.pend_n += 1
        need = int(self.scoring["debounce"].get(metric["mode"], 1))
        if st.pend_n >= need and level != st.level:
            st.level = level
            if level in {"watch", "act"}:
                events.append(self._raise(reading, metric, st, level, now))
        self._help(reading.astronaut_id, now, events)
        return events

    def mark_silent(self, astronaut: str, sensor: str, last_good: float, now: float) -> list[dict]:
        metric = self.metrics.get(sensor)
        if metric is None:
            return []
        st = self.state(astronaut, sensor)
        st.bad_since = last_good
        value = st.last_value if st.last_value is not None else float(metric["sim"]["baseline"])
        from models import Reading

        reading = Reading(
            sensor_id=sensor,
            astronaut_id=astronaut,
            value=value,
            unit=metric["unit"],
            ts=now,
            quality=0.2,
            source="sim",
        )
        events = self._equipment(reading, metric, st, now)
        self._help(astronaut, now, events)
        return events

    def poll(self, astronaut: str, now: float) -> list[dict]:
        events: list[dict] = []
        self._help(astronaut, now, events)
        return events

    def snapshot(self, astronaut: str) -> dict:
        weights = self.scoring["system_weights"]
        systems: dict[str, list[float]] = {}
        for (who, sensor), st in self.states.items():
            if who != astronaut or st.n <= 0:
                continue
            metric = self.metrics.get(sensor)
            if metric is None:
                continue
            score = 100 * (1 - min(abs(st.last_z) / 4, 1))
            systems.setdefault(metric["system"], []).append(score)
        per = {name: sum(values) / len(values) for name, values in systems.items()}
        if per:
            num = sum(per[name] * float(weights.get(name, 1)) for name in per)
            den = sum(float(weights.get(name, 1)) for name in per)
            overall = num / den if den else 100.0
        else:
            overall = 100.0
        normal = float(self.scoring["level_normal"])
        watch = float(self.scoring["level_watch"])
        if overall >= normal:
            level = "Normal"
        elif overall >= watch:
            level = "Watch"
        else:
            level = "Act"
        active = [
            item
            for item in self.alerts
            if item["astronaut_id"] == astronaut and not item.get("acknowledged") and item.get("open", True)
        ]
        return {
            "astronaut_id": astronaut,
            "score": round(overall, 1),
            "level": level,
            "help_needed": bool(self.help.get(astronaut)),
            "systems": {name: round(value, 1) for name, value in per.items()},
            "alerts": active,
        }

    def _level(self, metric: dict, st: MetricState, value: float) -> tuple[str, float]:
        z = zscore(st.mean, st.var, value)
        norm = metric.get("norm") or {}
        ok, watch = norm.get("ok"), norm.get("watch")
        by_base = not ok and not watch
        z_act = float(self.scoring["z_act"])
        z_watch = float(self.scoring["z_watch"])
        if by_base:
            if abs(z) >= z_act:
                return "act", z
            if abs(z) >= z_watch:
                return "watch", z
            return "ok", z
        outside_watch = value < watch[0] or value > watch[1]
        outside_ok = value < ok[0] or value > ok[1]
        if outside_watch or abs(z) >= z_act:
            return "act", z
        if outside_ok or abs(z) >= z_watch:
            return "watch", z
        return "ok", z

    def _raise(self, reading, metric: dict, st: MetricState, level: str, now: float) -> dict:
        self._seq += 1
        action = self.actions.get(reading.sensor_id) or self.actions.get("default", "")
        since = st.since if st.since is not None else now
        explanation = (
            f"{metric['name_uk']}: {reading.value:.2f} {metric['unit']} vs baseline {st.mean:.2f} "
            f"(z={st.last_z:.1f}) since {since:.0f}. {action}"
        )
        alert = {
            "id": self._seq,
            "ts": now,
            "astronaut_id": reading.astronaut_id,
            "sensor_id": reading.sensor_id,
            "category": "health",
            "level": level,
            "message": f"{metric['name_uk']} {level}",
            "explanation": explanation,
            "acknowledged": 0,
            "open": True,
        }
        self.alerts.append(alert)
        return {"type": "alert", "data": alert}

    def _equipment(self, reading, metric: dict, st: MetricState, now: float) -> list[dict]:
        if st.bad_since is None:
            st.bad_since = now
        if st.equip or now - st.bad_since < float(self.scoring["equipment_seconds"]):
            return []
        st.equip = True
        self._seq += 1
        alert = {
            "id": self._seq,
            "ts": now,
            "astronaut_id": reading.astronaut_id,
            "sensor_id": reading.sensor_id,
            "category": "equipment",
            "level": "watch",
            "message": f"Немає надійного сигналу: {metric['name_uk']}",
            "explanation": "Якість нижче 0.5 довше 30 с. Це не проблема здоров'я.",
            "acknowledged": 0,
            "open": True,
        }
        self.alerts.append(alert)
        return [{"type": "alert", "data": alert}]

    def _help(self, astronaut: str, now: float, events: list[dict]) -> None:
        rules = self.scoring["help"]
        mine = [item for item in self.alerts if item["astronaut_id"] == astronaut]
        on = bool(self.help.get(astronaut))
        if not on and triggered(mine, now, rules):
            self.help[astronaut] = True
            self._seq += 1
            chosen = [item["sensor_id"] for item in mine if item["category"] == "health"][-6:]
            alert = {
                "id": self._seq,
                "ts": now,
                "astronaut_id": astronaut,
                "sensor_id": "HELP_NEEDED",
                "category": "health",
                "level": "act",
                "message": "HELP_NEEDED",
                "explanation": "Contact ground / crew medical officer. Alerts: " + ", ".join(chosen),
                "acknowledged": 0,
                "open": True,
            }
            self.alerts.append(alert)
            events.append({"type": "alert", "data": alert})
            events.append({"type": "status", "data": self.snapshot(astronaut), "ts": now})
        elif on and quiet(mine, now, rules["recovery_s"]):
            self.help[astronaut] = False
            events.append({"type": "status", "data": self.snapshot(astronaut), "ts": now})
