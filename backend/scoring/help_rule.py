"""Help is three spaced health alerts, not three repeats of one channel."""


def kept_alerts(alerts: list[dict], now: float, window_s: float, gap_s: float) -> list[dict]:
    recent = [
        item
        for item in alerts
        if item.get("category") == "health"
        and item.get("sensor_id") != "HELP_NEEDED"
        and item.get("level") in {"watch", "act"}
        and now - window_s <= item["ts"] <= now
    ]
    recent.sort(key=lambda item: (item["ts"], item["sensor_id"]))
    chosen: list[dict] = []
    for item in recent:
        if not chosen or item["ts"] - chosen[-1]["ts"] >= gap_s:
            chosen.append(item)
    return chosen


def triggered(alerts: list[dict], now: float, rules: dict) -> bool:
    chosen = kept_alerts(alerts, now, rules["window_s"], rules["min_gap_s"])
    metrics = {item["sensor_id"] for item in chosen}
    return len(chosen) >= rules["min_alerts"] and len(metrics) >= rules["min_metrics"]


def quiet(alerts: list[dict], now: float, recovery_s: float) -> bool:
    health = [
        item["ts"]
        for item in alerts
        if item.get("category") == "health"
        and item.get("sensor_id") != "HELP_NEEDED"
        and item.get("level") in {"watch", "act"}
    ]
    if not health:
        return True
    return now - max(health) >= recovery_s
