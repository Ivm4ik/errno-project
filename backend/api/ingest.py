import hmac
import json
import time
from collections import deque

from fastapi import APIRouter, HTTPException, Request, WebSocket

from clock import wall
from models import Envelope, Reading

router = APIRouter()
MAX_BODY = 256 * 1024
MAX_READINGS = 500


class Gate:
    def __init__(self) -> None:
        self.seen: set[tuple[str, int]] = set()
        self.last_seq: dict[str, int] = {}
        self.sync = None
        self.hits: dict[str, deque] = {}
        self.push_seen: dict[tuple[str, str], float] = {}

    def limited(self, device_id: str) -> bool:
        now = time.time()
        bucket = self.hits.setdefault(device_id, deque())
        while bucket and now - bucket[0] > 1:
            bucket.popleft()
        if len(bucket) >= 20:
            return True
        bucket.append(now)
        return False

    def note_seq(self, device_id: str, seq: int | None) -> tuple[bool, int]:
        """Return (duplicate, lost_packets)."""
        if seq is None:
            return False, 0
        key = (device_id, seq)
        if key in self.seen:
            return True, 0
        last = self.last_seq.get(device_id)
        lost = seq - last - 1 if last is not None and seq > last + 1 else 0
        self.seen.add(key)
        if last is None or seq > last:
            self.last_seq[device_id] = seq
        return False, lost


def _metric(request: Request, sensor_id: str) -> dict | None:
    return request.app.state.metrics_by_id.get(sensor_id)


def _plausible(metric: dict | None, reading: Reading) -> bool:
    if metric is None:
        return False
    bounds = metric.get("plausible")
    if bounds and not bounds[0] <= reading.value <= bounds[1]:
        reading.quality = 0
    if not reading.unit:
        reading.unit = metric["unit"]
    return True


async def _authorized(request: Request, device_id: str | None, token: str | None) -> None:
    if request.app.state.no_auth:
        return
    if not device_id or not token:
        raise HTTPException(401, "unknown token")
    from db import connect

    cx = await connect()
    try:
        row = await (await cx.execute("SELECT token FROM devices WHERE device_id=?", (device_id,))).fetchone()
    finally:
        await cx.close()
    stored = row["token"] if row else "missing-device"
    if row is None or not hmac.compare_digest(stored, token):
        raise HTTPException(401, "unknown token")


def accept_payload(request: Request, payload, token: str | None) -> dict:
    """Parse a body into readings. Auth is applied by the caller for HTTP after this returns device id... 

    Kept sync for the shared WS/HTTP path; the HTTP handler checks auth first.
    """
    gate: Gate = request.app.state.gate
    metrics = request.app.state.metrics_by_id
    readings: list[Reading] = []
    device_id = None
    seq = None
    buffered = False
    envelope_ts = None
    astronaut = None
    activity = "rest"
    time_scale = 1.0
    if isinstance(payload, dict):
        activity = payload.get("activity_mode") or "rest"
        try:
            time_scale = float(payload.get("time_scale") or 1)
        except (TypeError, ValueError):
            raise HTTPException(422, "time_scale")
    if activity not in {"rest", "exercise", "eva"}:
        raise HTTPException(422, "activity_mode")
    if isinstance(payload, list):
        for item in payload:
            readings.append(Reading.model_validate(item))
        device_id = readings[0].device_id if readings else None
        seq = readings[0].seq if readings else None
        astronaut = readings[0].astronaut_id if readings else None
    elif isinstance(payload, dict) and "readings" in payload:
        env = Envelope.model_validate(payload)
        device_id = env.device_id
        seq = env.seq
        buffered = env.buffered
        envelope_ts = env.ts_device
        astronaut = env.astronaut_id
        activity = env.activity_mode
        time_scale = env.time_scale
        for item in env.readings:
            readings.append(
                Reading(
                    sensor_id=item.sensor_id,
                    astronaut_id=item.astronaut_id or env.astronaut_id,
                    value=item.value,
                    unit=item.unit,
                    quality=item.quality,
                    source="device",
                    device_id=env.device_id,
                    seq=env.seq,
                    ts_device=item.ts_device if item.ts_device is not None else env.ts_device,
                    activity_mode=activity,
                )
            )
    else:
        one = Reading.model_validate(payload)
        readings = [one]
        device_id = one.device_id
        seq = one.seq
        astronaut = one.astronaut_id
    del token, astronaut
    if len(readings) > MAX_READINGS:
        raise HTTPException(413, "too many readings")
    if device_id and gate.limited(device_id):
        raise HTTPException(429, "rate limit")
    duplicate, lost = gate.note_seq(device_id or "", seq) if device_id else (False, 0)
    if duplicate:
        return {"accepted": 0, "dropped": 0, "duplicate": True, "queue": []}
    accepted = 0
    dropped = 0
    queued: list = []
    if device_id and seq is not None:
        queued.append(("seen", device_id, seq, lost))
    arrival = wall()
    sync = request.app.state.sync
    for reading in readings:
        metric = metrics.get(reading.sensor_id)
        if not _plausible(metric, reading):
            dropped += 1
            continue
        ts_device = reading.ts_device if reading.ts_device is not None else envelope_ts
        if reading.activity_mode is None:
            reading.activity_mode = activity
        if reading.ts is None:
            # time_scale > 1 means the sender's clock IS the simulated clock. Do not median-correct it.
            if time_scale > 1:
                reading.ts = ts_device if ts_device is not None else arrival
            else:
                reading.ts = sync.correct(device_id or reading.astronaut_id, ts_device, buffered, arrival)
        if reading.source == "sim":
            reading.source = "device"
        queued.append(reading)
        if reading.source != "sim":
            gate.push_seen[(reading.astronaut_id, reading.sensor_id)] = reading.ts
        accepted += 1
    return {"accepted": accepted, "dropped": dropped, "duplicate": False, "queue": queued}


@router.post("/ingest")
async def ingest(request: Request) -> dict:
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "body larger than 256KB")
    try:
        payload = json.loads(body)
    except json.JSONDecodeError as exc:
        raise HTTPException(400, "invalid json") from exc
    token = request.headers.get("x-device-token")
    device_id = _peek_device(payload)
    await _authorized(request, device_id, token)
    result = accept_payload(request, payload, token)
    for item in result.pop("queue"):
        request.app.state.queue.put_nowait(item)
    return result


def _peek_device(payload) -> str | None:
    if isinstance(payload, dict):
        return payload.get("device_id")
    if isinstance(payload, list) and payload:
        return payload[0].get("device_id")
    return None


@router.websocket("/ingest/ws")
async def ingest_ws(ws: WebSocket) -> None:
    await ws.accept()
    token = ws.headers.get("x-device-token") or ws.query_params.get("token")
    try:
        while True:
            raw = await ws.receive_text()
            if len(raw.encode()) > MAX_BODY:
                await ws.send_json({"accepted": 0, "dropped": 0, "duplicate": False, "error": "too large"})
                continue
            payload = json.loads(raw)
            device_id = _peek_device(payload)
            if not ws.app.state.no_auth:
                from db import connect

                cx = await connect()
                try:
                    row = await (await cx.execute("SELECT token FROM devices WHERE device_id=?", (device_id,))).fetchone()
                finally:
                    await cx.close()
                stored = row["token"] if row else "missing-device"
                if row is None or not token or not hmac.compare_digest(stored, token):
                    await ws.close(code=4401)
                    return
            result = accept_payload(ws, payload, token)
            for item in result.pop("queue"):
                ws.app.state.queue.put_nowait(item)
            await ws.send_json(result)
    except Exception:
        return
