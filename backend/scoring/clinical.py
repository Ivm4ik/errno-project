"""Apply penalties on the simulated clock and persist status, incidents, packets."""

import json
import os
import time

from scoring.penalty import compute
from scoring.rules import Rule, load_rules
from scoring.status_machine import StatusMachine
from scoring.validate import is_fault, validate_sensor_data

PACKET_CAP = 4000


def _dbg(hypothesis_id: str, location: str, message: str, data: dict) -> None:
    # Debug trace is off unless ERRNO_DEBUG_LOG points at a file.
    path = os.environ.get("ERRNO_DEBUG_LOG")
    if not path:
        return
    # #region agent log
    try:
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(
                json.dumps(
                    {
                        "sessionId": "b393a4",
                        "hypothesisId": hypothesis_id,
                        "location": location,
                        "message": message,
                        "data": data,
                        "timestamp": int(time.time() * 1000),
                        "runId": "pre-fix",
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    except Exception:
        pass
    # #endregion


class Clinical:
    def __init__(self, metrics: list[dict], crew_ids: list[str], penalty_cfg: dict, status_cfg: dict, delay_s: float) -> None:
        self.rules = load_rules()
        self.by_metric = {rule.metric: rule for rule in self.rules}
        self.canonical = {item["id"]: item["legacy_id"] for item in metrics if item.get("legacy_id")}
        self.sensor_of = {metric: sensor for sensor, metric in self.canonical.items()}
        self.plausible = {item["id"]: item.get("plausible") for item in metrics}
        self.names = {item["id"]: item.get("name_uk", item["id"]) for item in metrics}
        self.penalty_cfg = penalty_cfg
        self.status_cfg = dict(status_cfg)
        self.status_cfg["labels"] = {int(key): value for key, value in status_cfg["labels"].items()}
        self.delay_s = delay_s
        self.crew_ids = list(crew_ids)
        self.series: dict[tuple[str, str], list[dict]] = {}
        self.modes: dict[str, list[tuple[float, str]]] = {}
        self.machines: dict[str, StatusMachine] = {}
        self.bad_since: dict[tuple[str, str], float] = {}
        self.equip_open: set[tuple[str, str]] = set()
        self.instant: set[str] = set()
        self.glass: dict[str, int | None] = {}

    def observe(self, reading) -> None:
        mode = getattr(reading, "activity_mode", None) or "rest"
        if mode not in {"rest", "exercise", "eva"}:
            mode = "rest"
        self.modes.setdefault(reading.astronaut_id, []).append((float(reading.ts), mode))
        metric = self.canonical.get(reading.sensor_id)
        if metric is None:
            return
        bounds = self.plausible.get(reading.sensor_id)
        # Sanity check: null/NaN/beyond survival → equipment fault, not clinical red.
        # (Fusion cross-check runs later in penalty.compute with peer samples.)
        raw = getattr(reading, "value", None)
        lost = is_fault(validate_sensor_data(reading.sensor_id, raw, bounds))
        quality_ok = float(reading.quality) > float(self.penalty_cfg["quality_floor"])
        usable = quality_ok and not lost
        try:
            stored = None if raw is None else float(raw)
        except (TypeError, ValueError):
            stored = None
            lost = True
            usable = False
        self.series.setdefault((reading.astronaut_id, metric), []).append(
            {
                "ts": float(reading.ts),
                "value": stored,
                "usable": usable,
                "signal_lost": lost or not quality_ok,
                "plausible": bounds,
                "sensor_id": reading.sensor_id,
            }
        )
        rule = self.by_metric.get(metric)
        if rule is not None and rule.cooldown_s == 0:
            self.instant.add(reading.astronaut_id)

    def _as_of(self, astronaut: str, metric: str, ts: float) -> dict | None:
        rows = [item for item in self.series.get((astronaut, metric), []) if item["ts"] <= ts + 1e-9]
        return rows[-1] if rows else None

    def _mode(self, astronaut: str, ts: float) -> str:
        rows = [item for item in self.modes.get(astronaut, []) if item[0] <= ts + 1e-9]
        return rows[-1][1] if rows else "rest"

    def _samples(self, astronaut: str, ts: float) -> dict:
        samples = {}
        for rule in self.rules:
            slot = self._as_of(astronaut, rule.metric, ts)
            if slot is not None:
                samples[rule.metric] = slot
        return samples

    def _times(self, astronaut: str, sim_now: float) -> list[float]:
        machine = self.machines.setdefault(astronaut, StatusMachine())
        interval = float(self.status_cfg["EVAL_INTERVAL"])
        snapped = False
        if machine.last_eval is None:
            stamps = [item["ts"] for key, rows in self.series.items() if key[0] == astronaut for item in rows]
            if not stamps:
                # #region agent log
                _dbg("B", "clinical.py:_times", "no-stamps", {"astronaut": astronaut, "sim_now": sim_now, "status": machine.status, "clear_hold": machine.clear_hold})
                # #endregion
                return []
            machine.last_eval = min(stamps) - interval
        if sim_now - machine.last_eval > 86400 * 2:
            # ponytail: a multi-day gap would spin ~17k evals per day; snap and keep the latest sample.
            machine.last_eval = sim_now - interval
            snapped = True
        times = []
        cursor = machine.last_eval + interval
        while cursor <= sim_now + 1e-9:
            times.append(cursor)
            cursor += interval
        if astronaut in self.instant and (not times or sim_now - times[-1] > 1e-6):
            times.append(sim_now)
        # #region agent log
        if astronaut == "A1" or machine.status == 2:
            _dbg(
                "B",
                "clinical.py:_times",
                "eval-schedule",
                {
                    "astronaut": astronaut,
                    "sim_now": sim_now,
                    "last_eval": machine.last_eval,
                    "delta": (sim_now - (machine.last_eval or 0)),
                    "n_times": len(times),
                    "snapped": snapped,
                    "status": machine.status,
                    "clear_hold": machine.clear_hold,
                    "ahead": bool(machine.last_eval is not None and sim_now < machine.last_eval),
                },
            )
        # #endregion
        return times

    def _has_any(self, astronaut: str) -> bool:
        return any(key[0] == astronaut for key in self.series)

    async def catch_up(self, cx, key, sim_now: float) -> list[dict]:
        events: list[dict] = []
        for astronaut in self.crew_ids:
            if not self._has_any(astronaut) and astronaut not in self.machines:
                continue
            for moment in self._times(astronaut, sim_now):
                events.extend(await self._eval(cx, key, astronaut, moment))
        self._compact()
        self.instant.clear()
        return events

    def _compact(self) -> None:
        for key, rows in self.series.items():
            self.series[key] = rows[-1:]
        for astronaut, rows in self.modes.items():
            self.modes[astronaut] = rows[-1:]

    async def _eval(self, cx, key, astronaut: str, ts: float) -> list[dict]:
        events: list[dict] = []
        samples = self._samples(astronaut, ts)
        mode = self._mode(astronaut, ts)
        events.extend(await self._equipment(cx, key, astronaut, samples, ts))
        scored = compute(astronaut, samples, mode, ts, self.rules, self.penalty_cfg)
        machine = self.machines.setdefault(astronaut, StatusMachine())
        cooldowns = {rule.metric: rule.cooldown_s for rule in self.rules}
        decision = machine.step(ts, scored["rows"], cooldowns, self.status_cfg)
        health = decision["health_index"]
        # #region agent log
        if astronaut == "A1" or decision["status"] == 2 or decision["previous"] == 2:
            _dbg(
                "A",
                "clinical.py:_eval",
                "status-step",
                {
                    "astronaut": astronaut,
                    "ts": ts,
                    "total": decision["total"],
                    "max_p": decision["max_penalty"],
                    "previous": decision["previous"],
                    "status": decision["status"],
                    "changed": decision["changed"],
                    "reason": decision["reason"],
                    "health_index": health,
                    "clear_hold": machine.clear_hold,
                    "n_clear": int(self.status_cfg.get("N_CLEAR", 0)),
                    "level_from_total": 2 if decision["total"] >= float(self.status_cfg["T_CRIT"]) or decision["max_penalty"] >= float(self.status_cfg["T_SINGLE"]) else (1 if decision["total"] >= float(self.status_cfg["T_WARN"]) else 0),
                },
            )
        # #endregion
        await cx.execute(
            """INSERT INTO penalty_log(ts, astronaut_id, health_index, total, status, breakdown)
               VALUES(?, ?, ?, ?, ?, ?)""",
            (ts, astronaut, health, decision["total"], decision["status"], json.dumps(scored["rows"], ensure_ascii=False)),
        )
        await cx.execute(
            """INSERT INTO status_state(
                 astronaut_id, status, health_index, total, max_penalty, notice_count, reset_hold, clear_hold,
                 last_eval_ts, activity_mode, notices_json, break_glass, incident_id)
               VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(astronaut_id) DO UPDATE SET
                 status=excluded.status, health_index=excluded.health_index, total=excluded.total,
                 max_penalty=excluded.max_penalty, notice_count=excluded.notice_count, reset_hold=excluded.reset_hold,
                 clear_hold=excluded.clear_hold, last_eval_ts=excluded.last_eval_ts, activity_mode=excluded.activity_mode,
                 notices_json=excluded.notices_json,
                 break_glass=status_state.break_glass, incident_id=status_state.incident_id""",
            (
                astronaut,
                decision["status"],
                health,
                decision["total"],
                decision["max_penalty"],
                machine.notice_count,
                machine.reset_hold,
                machine.clear_hold,
                ts,
                mode,
                json.dumps(machine.notice_at),
                1 if self.glass.get(astronaut) else 0,
                self.glass.get(astronaut),
            ),
        )
        level = self.status_cfg["labels"][decision["status"]]
        await cx.execute(
            "INSERT INTO status(ts, astronaut_id, score, level, help_needed) VALUES(?, ?, ?, ?, ?)",
            (ts, astronaut, health, level, int(decision["status"] == 2)),
        )
        if decision["changed"]:
            await cx.execute(
                """INSERT INTO status_history(ts, astronaut_id, status, from_status, health_index, total, reason)
                   VALUES(?, ?, ?, ?, ?, ?, ?)""",
                (ts, astronaut, decision["status"], decision["previous"], health, decision["total"], decision["reason"]),
            )
            await _audit(cx, key, ts, "status", {"astronaut_id": astronaut, "status": decision["status"], "reason": decision["reason"]})
            events.append({"type": "status", "data": self.snapshot(astronaut, scored, decision, mode), "ts": ts})
        if decision["changed"] and decision["status"] == 2 and decision["previous"] != 2:
            events.extend(await self._open_glass(cx, key, astronaut, ts, scored))
        if decision["changed"] and decision["previous"] == 2 and decision["status"] != 2:
            await self._close_glass(cx, key, astronaut, ts, "hysteresis")
            events.append({"type": "breakglass", "data": {"astronaut_id": astronaut, "active": False}, "ts": ts})
        return events

    def snapshot(self, astronaut: str, scored: dict, decision: dict, mode: str) -> dict:
        status = decision["status"]
        return {
            "astronaut_id": astronaut,
            "score": round(decision["health_index"], 1),
            "health_index": round(decision["health_index"], 1),
            "level": self.status_cfg["labels"][status],
            "status": status,
            "help_needed": status == 2,
            "systems": {},
            "alerts": [],
            "activity_mode": mode,
            "total": round(decision["total"], 2),
            "critical_text": self.status_cfg["critical_text"] if status == 2 else None,
        }

    async def _equipment(self, cx, key, astronaut: str, samples: dict, ts: float) -> list[dict]:
        events = []
        limit = float(self.penalty_cfg["equipment_seconds"])
        for rule in self.rules:
            slot = samples.get(rule.metric)
            sensor = self.sensor_of.get(rule.metric, rule.metric)
            mark = (astronaut, sensor)
            if slot is None or slot.get("usable", True):
                self.bad_since.pop(mark, None)
                self.equip_open.discard(mark)
                continue
            start = self.bad_since.setdefault(mark, float(slot["ts"]))
            if mark in self.equip_open or ts - start < limit:
                continue
            self.equip_open.add(mark)
            message = f"Немає надійного сигналу: {self.names.get(sensor, rule.metric)}"
            cur = await cx.execute(
                """INSERT INTO alerts(ts, astronaut_id, sensor_id, category, level, message, explanation, acknowledged)
                   VALUES(?, ?, ?, 'equipment', 'watch', ?, ?, 0)""",
                (ts, astronaut, sensor, message, "Якість ≤ 0.2 або значення поза правдоподібним діапазоном щонайменше 30 с. Це не медичний статус."),
            )
            await _audit(cx, key, ts, "alert", {"id": cur.lastrowid, "sensor_id": sensor, "level": "equipment"})
            events.append(
                {
                    "type": "alert",
                    "data": {
                        "id": cur.lastrowid,
                        "ts": ts,
                        "astronaut_id": astronaut,
                        "sensor_id": sensor,
                        "category": "equipment",
                        "level": "watch",
                        "message": message,
                        "explanation": "Обладнання, не медицина.",
                        "acknowledged": 0,
                    },
                }
            )
        return events

    async def _open_glass(self, cx, key, astronaut: str, ts: float, scored: dict) -> list[dict]:
        if self.glass.get(astronaut):
            return []
        triggering = [row for row in scored["rows"] if row["penalty"] > 0]
        cur = await cx.execute(
            "INSERT INTO incidents(astronaut_id, opened_at, break_glass, trigger_json) VALUES(?, ?, 1, ?)",
            (astronaut, ts, json.dumps([row["metric"] for row in triggering], ensure_ascii=False)),
        )
        incident_id = cur.lastrowid
        self.glass[astronaut] = incident_id
        await cx.execute(
            "UPDATE status_state SET break_glass=1, incident_id=? WHERE astronaut_id=?",
            (incident_id, astronaut),
        )
        for row in triggering:
            rule = self.by_metric[row["metric"]]
            await cx.execute(
                "INSERT INTO incident_steps(incident_id, ts, actor_login, text, done) VALUES(?, ?, ?, ?, 0)",
                (incident_id, ts, "system", rule.cmo),
            )
        history = await self._history(cx, astronaut, ts)
        payload = {
            "astronaut_id": astronaut,
            "surgeon": [{"metric": row["metric"], "text": self.by_metric[row["metric"]].surgeon} for row in triggering],
            "breakdown": scored["rows"],
            "readings": history,
            "history_sec": 21600,
        }
        visible = ts + self.delay_s
        packet = await cx.execute(
            "INSERT INTO earth_packets(astronaut_id, created_at, visible_at, payload, incident_id) VALUES(?, ?, ?, ?, ?)",
            (astronaut, ts, visible, json.dumps(payload, ensure_ascii=False), incident_id),
        )
        await _audit(cx, key, ts, "breakglass", {"astronaut_id": astronaut, "incident_id": incident_id, "active": True})
        return [
            {"type": "breakglass", "data": {"astronaut_id": astronaut, "incident_id": incident_id, "active": True}, "ts": ts},
            {
                "type": "earth_packet",
                "data": {"id": packet.lastrowid, "astronaut_id": astronaut, "created_at": ts, "visible_at": visible},
                "ts": ts,
            },
        ]

    async def _history(self, cx, astronaut: str, ts: float) -> list[dict]:
        start = ts - 21600
        rows = await (
            await cx.execute(
                """SELECT ts, sensor_id, value, unit, quality FROM readings
                   WHERE astronaut_id=? AND ts>=? AND ts<=? ORDER BY ts""",
                (astronaut, start, ts),
            )
        ).fetchall()
        packed = [dict(row) for row in rows]
        if len(packed) <= PACKET_CAP:
            return packed
        step = max(1, len(packed) // PACKET_CAP)
        return packed[::step][:PACKET_CAP]

    async def _close_glass(self, cx, key, astronaut: str, ts: float, why: str) -> None:
        incident_id = self.glass.get(astronaut)
        self.glass[astronaut] = None
        await cx.execute(
            "UPDATE status_state SET break_glass=0 WHERE astronaut_id=?",
            (astronaut,),
        )
        if incident_id:
            await cx.execute("UPDATE incidents SET closed_at=?, break_glass=0 WHERE id=? AND closed_at IS NULL", (ts, incident_id))
        await _audit(cx, key, ts, "breakglass", {"astronaut_id": astronaut, "incident_id": incident_id, "active": False, "why": why})

    async def hydrate(self, cx) -> None:
        for row in await (await cx.execute("SELECT * FROM status_state")).fetchall():
            machine = StatusMachine(
                status=row["status"],
                notice_count=row["notice_count"],
                reset_hold=row["reset_hold"],
                clear_hold=row["clear_hold"],
                last_eval=row["last_eval_ts"],
                notice_at=json.loads(row["notices_json"] or "{}"),
            )
            self.machines[row["astronaut_id"]] = machine
            if row["break_glass"]:
                self.glass[row["astronaut_id"]] = row["incident_id"]
            if row["activity_mode"]:
                self.modes[row["astronaut_id"]] = [(row["last_eval_ts"] or 0, row["activity_mode"])]
        latest = await (
            await cx.execute(
                """SELECT r.astronaut_id, r.sensor_id, r.value, r.ts, r.quality
                   FROM readings r
                   JOIN (SELECT astronaut_id, sensor_id, MAX(id) AS id FROM readings GROUP BY astronaut_id, sensor_id) x
                     ON x.id = r.id"""
            )
        ).fetchall()
        for row in latest:
            metric = self.canonical.get(row["sensor_id"])
            if metric is None:
                continue
            bounds = self.plausible.get(row["sensor_id"])
            plausible = True if not bounds else bounds[0] <= row["value"] <= bounds[1]
            usable = float(row["quality"] or 0) > float(self.penalty_cfg["quality_floor"]) and plausible
            self.series[(row["astronaut_id"], metric)] = [
                {"ts": row["ts"], "value": row["value"], "usable": usable, "sensor_id": row["sensor_id"]}
            ]
        self.instant.clear()


async def _audit(cx, key, ts: float, kind: str, payload: dict) -> None:
    from db import append_audit

    await append_audit(cx, key, ts, kind, payload)


def rules_index() -> dict[str, Rule]:
    return {rule.metric: rule for rule in load_rules()}
