"""Read microcontroller lines and POST them to /ingest.

Replay a recorded file when there is no board:

    python gateway/serial_gateway.py --replay capture.jsonl --api http://127.0.0.1:8000 --token secret --astronaut A1 --device-id gw-1
"""

import argparse
import asyncio
import json
import time
from pathlib import Path

import httpx
import yaml

ROOT = Path(__file__).resolve().parent


def load_mapping(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def convert(fields: dict, mapping: dict, astronaut: str, device_id: str, epoch0: float | None, arrival: float):
    ms = float(fields.get("ms") or 0)
    if epoch0 is None:
        epoch0 = arrival - ms / 1000
    ts = epoch0 + ms / 1000
    quality = 0.2 if fields.get("lo") else 1.0
    readings = []
    for key, spec in mapping.items():
        if key not in fields:
            continue
        readings.append(
            {
                "sensor_id": spec["sensor_id"],
                "value": float(fields[key]),
                "unit": spec["unit"],
                "quality": quality,
                "ts_device": ts,
                "astronaut_id": astronaut,
            }
        )
    return epoch0, readings


def envelope(device_id: str, astronaut: str, seq: int, readings: list, buffered: bool) -> dict:
    return {
        "device_id": device_id,
        "astronaut_id": astronaut,
        "seq": seq,
        "buffered": buffered,
        "ts_device": readings[0]["ts_device"] if readings else None,
        "readings": readings,
    }


def post_envelope(api: str, token: str, body: dict) -> bool:
    try:
        response = httpx.post(f"{api.rstrip('/')}/ingest", json=body, headers={"X-Device-Token": token}, timeout=5)
        return 200 <= response.status_code < 300
    except httpx.HTTPError:
        return False


def flush_outbox(path: Path, api: str, token: str) -> None:
    if not path.exists():
        return
    lines = path.read_text(encoding="utf-8").splitlines()
    keep: list[str] = []
    for index, line in enumerate(lines):
        body = json.loads(line)
        body["buffered"] = True
        if not post_envelope(api, token, body):
            keep = lines[index:]
            break
    path.write_text("\n".join(keep) + ("\n" if keep else ""), encoding="utf-8")


def remember(path: Path, body: dict) -> None:
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(body) + "\n")


async def replay(args, mapping: dict) -> None:
    epoch0 = None
    outbox = Path(args.outbox)
    flush_outbox(outbox, args.api, args.token)
    pending: list = []
    second: int | None = None
    seq = 0
    for line in Path(args.replay).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            fields = json.loads(line)
        except json.JSONDecodeError:
            continue
        epoch0, readings = convert(fields, mapping, args.astronaut, args.device_id, epoch0, time.time())
        stamp = int(readings[0]["ts_device"]) if readings else None
        if second is None:
            second = stamp
        if stamp != second and pending:
            seq += 1
            body = envelope(args.device_id, args.astronaut, seq, pending, False)
            if not post_envelope(args.api, args.token, body):
                remember(outbox, body)
            pending = []
            second = stamp
        pending.extend(readings)
    if pending:
        seq += 1
        body = envelope(args.device_id, args.astronaut, seq, pending, False)
        if not post_envelope(args.api, args.token, body):
            remember(outbox, body)


async def serial_loop(args, mapping: dict) -> None:
    import serial_asyncio

    outbox = Path(args.outbox)
    delay = 1
    while True:
        try:
            reader, _ = await serial_asyncio.open_serial_connection(url=args.port, baudrate=args.baud)
            delay = 1
            epoch0 = None
            seq_expect = None
            pending: list = []
            second: int | None = None
            while True:
                raw = await reader.readline()
                try:
                    fields = json.loads(raw.decode(errors="ignore"))
                except json.JSONDecodeError:
                    continue
                seq = fields.get("seq")
                if seq_expect is not None and isinstance(seq, int) and seq > seq_expect:
                    print(f"seq gap {seq_expect} -> {seq}")
                if isinstance(seq, int):
                    seq_expect = seq + 1
                epoch0, readings = convert(fields, mapping, args.astronaut, args.device_id, epoch0, time.time())
                stamp = int(readings[0]["ts_device"]) if readings else None
                if second is None:
                    second = stamp
                if stamp != second and pending:
                    body = envelope(args.device_id, args.astronaut, int(fields.get("seq") or 0), pending, False)
                    flush_outbox(outbox, args.api, args.token)
                    if not post_envelope(args.api, args.token, body):
                        remember(outbox, body)
                    pending = []
                    second = stamp
                pending.extend(readings)
        except Exception as exc:
            print(f"serial dropped: {exc}")
            await asyncio.sleep(delay)
            delay = min(10, delay * 2)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default="")
    parser.add_argument("--baud", type=int, default=115200)
    parser.add_argument("--api", default="http://127.0.0.1:8000")
    parser.add_argument("--token", default="secret")
    parser.add_argument("--astronaut", default="A1")
    parser.add_argument("--device-id", default="gw-1")
    parser.add_argument("--replay", default="")
    parser.add_argument("--mapping", default=str(ROOT / "mapping.yaml"))
    parser.add_argument("--outbox", default="outbox.jsonl")
    args = parser.parse_args()
    mapping = load_mapping(Path(args.mapping))
    if args.replay:
        asyncio.run(replay(args, mapping))
    else:
        asyncio.run(serial_loop(args, mapping))


if __name__ == "__main__":
    main()
