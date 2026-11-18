import asyncio
import json
import logging

from clock import wall
from models import Reading
from sensors.base import SensorDriver

log = logging.getLogger(__name__)


def line_to_fields(raw: str) -> dict | None:
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


class Esp32Driver(SensorDriver):
    def __init__(self, metric_cfg, astronaut_id, out_queue, port: str, baud: int = 115200) -> None:
        super().__init__(metric_cfg, astronaut_id, out_queue)
        self.port = port
        self.baud = baud

    async def run(self) -> None:
        try:
            import serial_asyncio
        except ImportError:
            log.warning("pyserial is not installed; ESP32 falls back to the gateway or simulation")
            return
        while self._running:
            try:
                reader, _ = await serial_asyncio.open_serial_connection(url=self.port, baudrate=self.baud)
                epoch0 = None
                while self._running:
                    line = await reader.readline()
                    fields = line_to_fields(line.decode(errors="ignore"))
                    if not fields:
                        continue
                    ms = float(fields.get("ms") or 0)
                    if epoch0 is None:
                        epoch0 = wall() - ms / 1000
                    quality = 0.2 if fields.get("lo") else 1.0
                    ts = epoch0 + ms / 1000
                    for key, unit in (("hr", "bpm"), ("spo2", "%"), ("temp", "C"), ("resp", "breaths/min")):
                        if key in fields:
                            self.out_queue.put_nowait(
                                Reading(
                                    sensor_id=key if key != "temp" else "temp",
                                    astronaut_id=self.astronaut_id,
                                    value=float(fields[key]),
                                    unit=unit,
                                    ts=ts,
                                    quality=quality,
                                    source="esp32",
                                    device_id=self.port,
                                )
                            )
            except Exception:
                log.warning("ESP32 serial dropped; retrying", exc_info=True)
                await asyncio.sleep(2)
