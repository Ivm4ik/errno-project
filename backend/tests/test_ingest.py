from fastapi.testclient import TestClient

from timesync import TimeSync


def test_buffered_keeps_the_old_offset():
    sync = TimeSync()
    # device clock is 10 s behind the server
    assert sync.correct("gw-1", ts_device=1000, buffered=False, arrival=1010) == 1010
    # a stored packet must use that offset, not the new arrival
    assert sync.correct("gw-1", ts_device=1000, buffered=True, arrival=5000) == 1010


def test_implausible_is_accepted_and_duplicate_seq_is_ignored():
    from main import app

    with TestClient(app) as client:
        assert client.get("/health").json()["status"] == "ok"
        bad = client.post("/ingest", json={"sensor_id": "hr", "astronaut_id": "A1", "value": 400, "unit": "bpm"})
        assert bad.status_code == 200
        assert bad.json()["accepted"] == 1
        unknown = client.post("/ingest", json={"sensor_id": "nope", "astronaut_id": "A1", "value": 1, "unit": "x"})
        assert unknown.json() == {"accepted": 0, "dropped": 1, "duplicate": False}
        body = {
            "device_id": "gw-1",
            "astronaut_id": "A1",
            "seq": 7,
            "readings": [{"sensor_id": "hr", "value": 71, "unit": "bpm"}],
        }
        assert client.post("/ingest", json=body).json()["duplicate"] is False
        again = client.post("/ingest", json=body).json()
        assert again["duplicate"] is True
        assert again["accepted"] == 0
        app.state.demo = False
        assert client.post("/audit/tamper").status_code == 403


def test_fast_time_scale_trusts_device_clock():
    from main import app

    with TestClient(app) as client:
        body = {
            "device_id": "gw-1",
            "astronaut_id": "A1",
            "seq": 90,
            "time_scale": 60,
            "ts_device": 1_700_000_000,
            "readings": [{"sensor_id": "hr", "value": 72, "unit": "bpm", "ts_device": 1_700_000_000}],
        }
        assert client.post("/ingest", json=body).status_code == 200
        assert client.post("/ingest", json={**body, "activity_mode": "sprint"}).status_code == 422


def test_gateway_lead_off_is_low_quality():
    from pathlib import Path

    from gateway.serial_gateway import convert, load_mapping

    mapping = load_mapping(Path(__file__).resolve().parents[1] / "gateway" / "mapping.yaml")
    _epoch, readings = convert({"seq": 1, "ms": 1000, "hr": 72, "lo": 1}, mapping, "A1", "gw-1", None, 5000)
    assert readings[0]["sensor_id"] == "hr"
    assert readings[0]["quality"] == 0.2
    assert readings[0]["ts_device"] == 5000
