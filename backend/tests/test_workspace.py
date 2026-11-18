"""Every browser gets its own sandbox, and accounts are picked without a password."""

import time

import pytest
from fastapi.testclient import TestClient

from main import app

WS_A = "aaaaaaaaaaaa1111"
WS_B = "bbbbbbbbbbbb2222"


def _h(ws: str, token: str | None = None) -> dict:
    out = {"X-Workspace": ws}
    if token:
        out["Authorization"] = f"Bearer {token}"
    return out


def _select(client: TestClient, ws: str, login: str) -> str:
    response = client.post("/auth/select", json={"login": login}, headers=_h(ws))
    assert response.status_code == 200, response.text
    return response.json()["token"]


def _ingest(client: TestClient, ws: str, astronaut: str, value: float) -> None:
    now = time.time()
    body = {
        "device_id": "web-gen",
        "astronaut_id": astronaut,
        "time_scale": 1,
        "activity_mode": "rest",
        "ts_device": now,
        "readings": [{"sensor_id": "hr", "value": value, "unit": "bpm", "quality": 1, "ts_device": now}],
    }
    response = client.post("/ingest", json=body, headers=_h(ws))
    assert response.status_code == 200, response.text
    assert response.json()["accepted"] == 1


def _latest_hr(client: TestClient, ws: str, token: str, astronaut: str) -> float | None:
    for _ in range(40):
        board = client.get("/sensors/board", params={"astronaut_id": astronaut}, headers=_h(ws, token))
        assert board.status_code == 200, board.text
        hit = next(item for item in board.json()["sensors"] if item["id"] == "hr")
        if hit["value"] is not None:
            return hit["value"]
        time.sleep(0.1)
    return None


def test_pick_account_without_password():
    # No password anywhere: the old login endpoint is gone.

    with TestClient(app) as client:
        accounts = client.get("/auth/accounts", headers=_h(WS_A))
        assert accounts.status_code == 200
        logins = {item["login"] for item in accounts.json()}
        assert {"doctor", "officer", "astronaut"} <= logins
        assert all("password" not in key for item in accounts.json() for key in item)

        session = client.post("/auth/select", json={"login": "astronaut"}, headers=_h(WS_A))
        assert session.status_code == 200
        body = session.json()
        assert body["role"] == "astronaut" and body["astronaut_id"] == "A1" and body["token"]
        me = client.get("/auth/me", headers=_h(WS_A, body["token"]))
        assert me.status_code == 200 and me.json()["login"] == "astronaut"

        assert client.post("/auth/select", json={"login": "nobody"}, headers=_h(WS_A)).status_code == 404
        assert client.post("/auth/login", json={"login": "doctor", "password": "x"}, headers=_h(WS_A)).status_code == 404


def test_sandboxes_do_not_share_data_or_sessions():
    with TestClient(app) as client:
        token_a = _select(client, WS_A, "astronaut")
        token_b = _select(client, WS_B, "astronaut")

        _ingest(client, WS_A, "A1", 91)
        assert _latest_hr(client, WS_A, token_a, "A1") == pytest.approx(91)

        # B never received anything, and A's token means nothing there.
        board = client.get("/sensors/board", params={"astronaut_id": "A1"}, headers=_h(WS_B, token_b))
        assert board.status_code == 200
        assert next(item for item in board.json()["sensors"] if item["id"] == "hr")["value"] is None
        assert client.get("/auth/me", headers=_h(WS_B, token_a)).status_code == 401

        _ingest(client, WS_B, "A1", 63)
        assert _latest_hr(client, WS_B, token_b, "A1") == pytest.approx(63)
        assert _latest_hr(client, WS_A, token_a, "A1") == pytest.approx(91)


def test_workspace_info_and_reset():
    with TestClient(app) as client:
        token = _select(client, WS_A, "doctor")
        info = client.get("/workspace", headers=_h(WS_A, token)).json()
        assert info["isolated"] is True and info["id"] == WS_A and info["max_run_sec"] == 600

        assert client.delete("/workspace", headers=_h(WS_A, token)).json() == {"ok": True}
        # A new database means the old session is gone.
        assert client.get("/auth/me", headers=_h(WS_A, token)).status_code == 401
        assert client.get("/auth/accounts", headers=_h(WS_A)).status_code == 200


def test_default_workspace_cannot_be_reset_and_bad_ids_are_refused():
    with TestClient(app) as client:
        assert client.delete("/workspace").status_code == 400
        assert client.get("/health", headers={"X-Workspace": "../etc/passwd"}).status_code == 400
        assert client.get("/health", headers={"X-Workspace": "short"}).status_code == 400


def test_live_socket_is_scoped_to_its_workspace():
    with TestClient(app) as client:
        token = _select(client, WS_A, "astronaut")
        with client.websocket_connect(f"/live?token={token}&ws={WS_A}") as sock:
            assert sock.receive_json()["type"] == "hello"
        # The same token is unknown in another sandbox.
        with pytest.raises(Exception):
            with client.websocket_connect(f"/live?token={token}&ws={WS_B}") as sock:
                sock.receive_json()
