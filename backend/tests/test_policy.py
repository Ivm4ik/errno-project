import json
import os
import time

from fastapi.testclient import TestClient

from main import app


def _login(client: TestClient, login: str) -> dict:
    response = client.post("/auth/select", json={"login": login})
    assert response.status_code == 200, response.text
    return response.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def _wait():
    time.sleep(0.6)


def _ingest(client, seq, astronaut, readings, ts, mode="rest", scale=60):
    body = {
        "device_id": "sim-gw-1",
        "astronaut_id": astronaut,
        "seq": seq,
        "time_scale": scale,
        "activity_mode": mode,
        "ts_device": ts,
        "readings": readings,
    }
    response = client.post("/ingest", json=body)
    assert response.status_code == 200, response.text
    return response.json()


def test_delay_hides_fresh_ship_data_and_packet_body():
    with TestClient(app) as client:
        app.state.delay = 20
        app.state.clinical.delay_s = 20
        app.state.clock.now = 10_030
        doctor = _login(client, "doctor")["token"]
        _ingest(client, 501, "A1", [{"sensor_id": "hr", "value": 80, "unit": "bpm", "ts_device": 10_000}], 10_000)
        _ingest(client, 502, "A1", [{"sensor_id": "hr", "value": 160, "unit": "bpm", "ts_device": 10_020}], 10_020)
        _wait()
        rows = client.get("/readings", params={"astronaut_id": "A1", "sensor_id": "hr", "from": 0, "to": 20_000}, headers=_auth(doctor)).json()
        assert rows and all(row["ts"] <= 10_010 for row in rows)
        assert all(row["value"] != 160 for row in rows)
        packets = client.get("/earth/packets", headers=_auth(doctor)).json()
        assert packets
        fresh = packets[0]
        assert fresh["in_transit"] is True
        assert fresh["payload"] is None
        assert "transit" in fresh["message"]
        app.state.clock.now = fresh["visible_at"] + 1
        revealed = client.get(f"/earth/packets/{fresh['id']}", headers=_auth(doctor)).json()
        assert revealed["payload"] is not None
        app.state.delay = 0
        app.state.clinical.delay_s = 0


def test_access_breakglass_and_hidden_metrics():
    with TestClient(app) as client:
        app.state.delay = 0
        app.state.clinical.delay_s = 0
        astronaut = _login(client, "astronaut")
        officer = _login(client, "officer")
        doctor = _login(client, "doctor")
        assert client.get("/readings", params={"astronaut_id": "A2", "sensor_id": "hr"}, headers=_auth(astronaut["token"])).status_code == 403
        base = time.time() + 50
        _ingest(
            client,
            601,
            "A1",
            [
                {"sensor_id": "hr", "value": 80, "unit": "bpm", "ts_device": base},
                {"sensor_id": "glucose", "value": 40, "unit": "mg/dL", "ts_device": base},
            ],
            base,
        )
        _wait()
        assert client.get("/emergency/A1", headers=_auth(officer["token"])).status_code == 200
        penalties = client.get("/penalties", params={"astronaut_id": "A1"}, headers=_auth(astronaut["token"])).json()
        assert all(row["metric"] != "GLU" for row in penalties["rows"])
        doctor_rows = client.get("/penalties", params={"astronaut_id": "A1"}, headers=_auth(doctor["token"])).json()["rows"]
        assert any(row["metric"] == "GLU" and row["penalty"] > 0 for row in doctor_rows)
        blocked = client.get("/readings", params={"astronaut_id": "A1", "sensor_id": "hr", "from": base - 5, "to": base + 5}, headers=_auth(officer["token"]))
        assert blocked.status_code == 200
        assert blocked.json()
        hud = client.get("/hud", params={"astronaut_id": "A1"}, headers=_auth(astronaut["token"])).json()
        assert hud["status"] == 2
        assert hud["critical_text"]
        assert all(card["metric"] != "GLU" for card in hud["cards"])


def test_exercise_does_not_open_glass_and_fault_stays_medical_quiet():
    with TestClient(app) as client:
        base = time.time() + 5_000
        readings = [
            {"sensor_id": "hr", "value": 150, "unit": "bpm", "ts_device": base + index}
            for index in range(0, 40, 5)
        ]
        _ingest(client, 701, "A2", readings, base + 35, mode="exercise")
        _wait()
        officer = _login(client, "officer")["token"]
        own = client.get("/status", params={"astronaut_id": "A2"}, headers=_auth(officer)).json()
        assert own["status"] == 0
        fault_base = base + 100
        fault = [
            {"sensor_id": "hr", "value": 180, "unit": "bpm", "quality": 0.2, "ts_device": fault_base + index}
            for index in range(0, 40, 5)
        ]
        _ingest(client, 702, "A2", fault, fault_base + 35)
        _wait()
        again = client.get("/status", params={"astronaut_id": "A2"}, headers=_auth(officer)).json()
        assert again["status"] == 0
        alerts = client.get("/alerts", params={"astronaut_id": "A2", "active": True}, headers=_auth(officer)).json()
        assert any(item["category"] == "equipment" for item in alerts)
