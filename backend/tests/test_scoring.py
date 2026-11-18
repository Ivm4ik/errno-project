from config_loader import load_yaml
from models import Reading
from scoring.engine import Engine
from sensors.polar import parse_hr, rmssd


def engine() -> Engine:
    metrics = {item["id"]: item for item in load_yaml("metrics.yaml")["metrics"]}
    return Engine(metrics, load_yaml("scoring.yaml"), load_yaml("actions.yaml"))


def hr(value: float, ts: float, quality: float = 1.0) -> Reading:
    return Reading(sensor_id="hr", astronaut_id="A1", value=value, unit="bpm", ts=ts, quality=quality, source="sim")


def test_warmup_does_not_alert():
    box = engine()
    for index in range(120):
        assert box.step(hr(70, index)) == []
    assert box.alerts == []


def test_five_high_samples_raise_one_alert():
    box = engine()
    for index in range(120):
        box.step(hr(70, index))
    events = []
    for index in range(5):
        events.extend(box.step(hr(160, 120 + index)))
    alerts = [item for item in events if item["type"] == "alert" and item["data"]["category"] == "health"]
    assert len(alerts) == 1
    assert alerts[0]["data"]["level"] == "act"


def test_bad_quality_is_equipment_not_health():
    box = engine()
    for index in range(120):
        box.step(hr(70, index))
    for index in range(40):
        box.step(hr(200, 200 + index, quality=0.2))
    assert [item["category"] for item in box.alerts] == ["equipment"]
    assert not box.help.get("A1")


def test_polar_flags_and_rmssd():
    # 16-bit HR, energy field present, two RR intervals of 1024/1024 s and 512/1024 s
    data = bytes([0x01 | 0x08 | 0x10, 72, 0, 1, 0, 0x00, 0x04, 0x00, 0x02])
    heart, rrs = parse_hr(data)
    assert heart == 72
    assert rrs == [1.0, 0.5]
    assert rmssd([1.0, 0.5, 1.0]) is not None
