"""Play sensor traffic through the API, the way the browser generator does."""

import time

from fastapi.testclient import TestClient

from main import app

# A1 baselines (Astro1). Only the metrics a scenario touches are sent.
BASE = {"hr": 80, "resp": 16, "spo2": 98, "temp": 36.6, "k": 4.2, "glucose": 85, "co2": 0.3}
UNITS = {"hr": "bpm", "resp": "breaths/min", "spo2": "%", "temp": "C", "k": "mmol/L", "glucose": "mg/dL", "co2": "%"}


def _login(client: TestClient, login: str) -> str:
    response = client.post("/auth/select", json={"login": login})
    assert response.status_code == 200, response.text
    return response.json()["token"]


def _play(client: TestClient, start: float, seconds: int, mode: str = "rest", **shift: float) -> None:
    """One reading per sensor per simulated second, shifted by `shift`, at time_scale 60."""
    readings = []
    for second in range(seconds):
        for sensor, base in BASE.items():
            readings.append(
                {
                    "sensor_id": sensor,
                    "value": base + shift.get(sensor, 0.0),
                    "unit": UNITS[sensor],
                    "quality": 1.0,
                    "ts_device": start + second,
                }
            )
    for index in range(0, len(readings), 500):
        chunk = readings[index : index + 500]
        envelope = {
            "device_id": "web-gen",
            "astronaut_id": "A1",
            "time_scale": 60,
            "activity_mode": mode,
            "ts_device": chunk[-1]["ts_device"],
            "readings": chunk,
        }
        response = client.post("/ingest", json=envelope)
        assert response.status_code == 200, response.text
    time.sleep(0.6)


def _get(client: TestClient, path: str, token: str, **params):
    last = ""
    for _ in range(30):
        try:
            response = client.get(path, params=params, headers={"Authorization": f"Bearer {token}"})
        except Exception as exc:
            last = str(exc)
            time.sleep(0.3)
            continue
        if response.status_code == 200:
            return response
        last = response.text
        time.sleep(0.3)
    raise AssertionError(last)


def _status(client: TestClient, token: str) -> int:
    return int(_get(client, "/status", token, astronaut_id="A1").json()["status"])


def test_key_scenarios_against_the_api():
    with TestClient(app) as client:
        token = _login(client, "astronaut")
        officer = _login(client, "officer")
        base = time.time() + 800

        _play(client, base, 60)
        assert _status(client, token) == 0

        # Exercise lifts pulse and breathing, and the backend forgives that.
        _play(client, base + 120, 60, mode="exercise", hr=45, resp=8)
        assert _status(client, token) == 0

        _play(client, base + 400, 60, hr=80)
        assert _status(client, token) == 2
        blocked = client.get("/emergency/A1", headers={"Authorization": f"Bearer {token}"})
        assert blocked.status_code == 403
        opened = _get(client, "/emergency/A1", officer)
        assert opened.json()["rows"]
