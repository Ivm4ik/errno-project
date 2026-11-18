"""Status from penalties only. Zones stay a highlight, not a decision."""

from dataclasses import dataclass, field


@dataclass
class StatusMachine:
    status: int = 0
    notice_count: int = 0
    reset_hold: int = 0
    clear_hold: int = 0
    last_eval: float | None = None
    notice_at: dict = field(default_factory=dict)

    def threshold(self, total: float, max_p: float, cfg: dict) -> int:
        if total >= float(cfg["T_CRIT"]) or max_p >= float(cfg["T_SINGLE"]):
            return 2
        if total >= float(cfg["T_WARN"]):
            return 1
        return 0

    def step(self, ts: float, rows: list[dict], cooldowns: dict[str, int], cfg: dict) -> dict:
        total = sum(float(item["penalty"]) for item in rows)
        max_p = max((float(item["penalty"]) for item in rows), default=0.0)
        level = self.threshold(total, max_p, cfg)
        counted = None
        if self.status == 1 and level == 1:
            for item in rows:
                if float(item["penalty"]) <= 0:
                    continue
                metric = item["metric"]
                last = self.notice_at.get(metric)
                window = int(cooldowns.get(metric, 0))
                if last is None or ts - last >= window:
                    self.notice_at[metric] = ts
                    self.notice_count += 1
                    counted = metric
                    break
            if self.notice_count >= 3:
                level = 2
        if level == 0:
            self.reset_hold += 1
            if self.reset_hold >= int(cfg["N_RESET"]):
                self.notice_count = 0
                self.notice_at.clear()
        else:
            self.reset_hold = 0
        previous = self.status
        if self.status == 2:
            if level < 2:
                self.clear_hold += 1
                new_status = level if self.clear_hold >= int(cfg["N_CLEAR"]) else 2
            else:
                self.clear_hold = 0
                new_status = 2
        else:
            new_status = level
            self.clear_hold = 0
        if new_status == 2 and previous != 2:
            self.notice_count = 0
            self.notice_at.clear()
            self.clear_hold = 0
        reason = "hold"
        if new_status != previous:
            if previous == 2:
                reason = "hysteresis"
            elif total >= float(cfg["T_CRIT"]):
                reason = "S>=T_CRIT"
            elif max_p >= float(cfg["T_SINGLE"]):
                reason = "max_P>=T_SINGLE"
            elif new_status == 2:
                reason = "3_notices"
            else:
                reason = "threshold"
        self.status = new_status
        self.last_eval = ts
        return {
            "status": new_status,
            "previous": previous,
            "changed": new_status != previous,
            "reason": reason,
            "total": total,
            "max_penalty": max_p,
            "health_index": max(0.0, 100.0 - total),
            "notice": counted,
        }
