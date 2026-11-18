from scoring.help_rule import kept_alerts, quiet, triggered

RULES = {"window_s": 3600, "min_alerts": 3, "min_metrics": 2, "min_gap_s": 300, "recovery_s": 1800}


def _alert(ts, sensor, level="watch", category="health"):
    return {"ts": ts, "sensor_id": sensor, "level": level, "category": category}


def test_burst_collapses_to_one():
    alerts = [_alert(t, "hr") for t in (0, 60, 120)]
    assert kept_alerts(alerts, now=120, window_s=3600, gap_s=300) == [alerts[0]]
    assert not triggered(alerts, 120, RULES)


def test_three_spaced_alerts_trigger():
    alerts = [_alert(0, "hr"), _alert(300, "temp"), _alert(600, "hr", "act")]
    assert triggered(alerts, 600, RULES)


def test_equipment_never_counts():
    alerts = [_alert(t, "hr", category="equipment") for t in (0, 300, 600)]
    assert not triggered(alerts, 600, RULES)


def test_two_metrics_are_not_enough_when_only_two_alerts():
    alerts = [_alert(0, "hr"), _alert(300, "temp")]
    assert not triggered(alerts, 300, RULES)


def test_recovery_waits_30_minutes():
    alerts = [_alert(0, "hr"), _alert(300, "temp"), _alert(600, "resp")]
    assert not quiet(alerts, 600 + 1799, 1800)
    assert quiet(alerts, 600 + 1800, 1800)
