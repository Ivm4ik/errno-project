import os
import sqlite3
import time

from fastapi.testclient import TestClient

from main import app


def _login(client: TestClient, login: str) -> str:
    response = client.post("/auth/select", json={"login": login})
    assert response.status_code == 200, response.text
    return response.json()["token"]


def test_roles_see_different_groups_and_officer_only_sees_alerts():
    with TestClient(app) as client:
        astronaut = _login(client, "astronaut")
        doctor = _login(client, "doctor")
        officer = _login(client, "officer")
        names = {item["id"] for item in client.get("/metrics", headers={"Authorization": f"Bearer {astronaut}"}).json()}
        assert "hr" in names and "sleep_hours" in names and "wbc" in names
        assert {"co2", "wellbeing", "lactate"} <= names
        assert "eeg_alpha" not in names and "glucose" not in names and "icp" not in names and "cortisol" not in names
        doctor_names = {item["id"] for item in client.get("/metrics", headers={"Authorization": f"Bearer {doctor}"}).json()}
        assert {"eeg_alpha", "glucose", "icp", "lactate", "wellbeing", "cortisol", "co2"} <= doctor_names
        assert client.get("/readings", params={"astronaut_id": "A1", "sensor_id": "eeg_alpha"}, headers={"Authorization": f"Bearer {astronaut}"}).status_code == 403

        now = time.time()
        db = sqlite3.connect(os.environ["DATABASE_PATH"])
        for astronaut_id in ("A1", "A2"):
            for value in (70, 160):
                db.execute(
                    "INSERT INTO readings(ts, astronaut_id, sensor_id, value, unit, quality, source) VALUES(?, ?, 'hr', ?, 'bpm', 1, 'manual')",
                    (now, astronaut_id, value),
                )
        db.commit()
        db.close()
        assert client.get(
            "/readings",
            params={"astronaut_id": "A1", "sensor_id": "hr", "from": now - 10},
            headers={"Authorization": f"Bearer {officer}"},
        ).status_code == 403
        rows = client.get(
            "/readings",
            params={"astronaut_id": "A2", "sensor_id": "hr", "from": now - 10},
            headers={"Authorization": f"Bearer {officer}"},
        ).json()
        assert [row["value"] for row in rows] == [70, 160]
        alerts = client.get("/range-alerts", headers={"Authorization": f"Bearer {officer}"}).json()
        assert any(item["sensor_id"] == "hr" and item["value"] == 160 for item in alerts)
        assert all(item["value"] != 70 for item in alerts)

        changed = client.put(
            "/limits",
            json={"astronaut_id": "A1", "sensor_id": "hr", "min": 40, "max": 180},
            headers={"Authorization": f"Bearer {doctor}"},
        )
        assert changed.status_code == 200
        log = client.get("/changes", params={"astronaut_id": "A1"}, headers={"Authorization": f"Bearer {doctor}"}).json()
        assert log[0]["actor_login"] == "doctor"
        assert {item["field"] for item in log[0]["diff"]} == {"min", "max"}
        assert {item["from"] for item in log[0]["diff"]} == {50, 100}
        raw = client.get(
            "/readings",
            params={"astronaut_id": "A1", "sensor_id": "hr", "from": now - 10},
            headers={"Authorization": f"Bearer {doctor}"},
        ).json()
        target = next(item for item in raw if item["value"] == 160)
        edited = client.put(
            f"/readings/{target['id']}",
            json={"value": 90, "note": "повторний вимір"},
            headers={"Authorization": f"Bearer {doctor}"},
        )
        assert edited.status_code == 200
        history = client.get("/changes", params={"astronaut_id": "A1"}, headers={"Authorization": f"Bearer {doctor}"}).json()
        assert history[0]["note"] == "повторний вимір"
        assert history[0]["diff"] == [{"sensor_id": "hr", "field": "value", "from": 160, "to": 90}]
        assert client.put(
            "/limits",
            json={"astronaut_id": "A1", "sensor_id": "hr", "min": 40, "max": 180},
            headers={"Authorization": f"Bearer {astronaut}"},
        ).status_code == 403
        created = client.post(
            "/accounts",
            json={"login": "astro2", "role": "astronaut", "name": "Другий"},
            headers={"Authorization": f"Bearer {doctor}"},
        )
        assert created.status_code == 200
        assert created.json()["astronaut_id"]
        assert client.post(
            "/accounts",
            json={"login": "nope", "role": "officer", "name": "Ні"},
            headers={"Authorization": f"Bearer {officer}"},
        ).status_code == 403
