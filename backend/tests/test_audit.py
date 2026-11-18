import json

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from audit import GENESIS, link, public_from, sign, verify_rows


def _row(prev: str, ts: float, kind: str, payload, key) -> dict:
    digest, _ = link(prev, ts, kind, payload)
    return {"ts": ts, "kind": kind, "payload": payload, "prev_hash": prev, "hash": digest, "sig": sign(key, digest)}


def test_chain_verifies_and_tamper_is_found():
    key = Ed25519PrivateKey.generate()
    rows = []
    prev = GENESIS
    for index, kind in enumerate(("alert", "status", "checkpoint"), start=1):
        row = _row(prev, index, kind, {"n": index}, key)
        rows.append(row)
        prev = row["hash"]
    assert verify_rows(rows, public_from(key)) == {"ok": True, "broken_at": None, "total": 3}
    broken = dict(rows[1])
    broken["payload"] = {"n": 2, "tampered": True}
    rows[1] = broken
    result = verify_rows(rows, public_from(key))
    assert result["ok"] is False
    assert result["broken_at"] == 2


def test_verify_rows_accept_payload_text():
    key = Ed25519PrivateKey.generate()
    row = _row(GENESIS, 1, "alert", {"n": 1}, key)
    row["payload"] = json.dumps(row["payload"], sort_keys=True)
    assert verify_rows([row], public_from(key))["ok"] is True
