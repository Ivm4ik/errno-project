import asyncio
import logging
import math

from sensors.base import SensorDriver

log = logging.getLogger(__name__)
HR_UUID = "00002a37-0000-1000-8000-00805f9b34fb"


def parse_hr(data: bytes) -> tuple[int, list[float]]:
    """Heart Rate Measurement. RR intervals are seconds (raw unit is 1/1024 s)."""
    flags = data[0]
    index = 1
    if flags & 0x01:
        hr = int.from_bytes(data[index : index + 2], "little")
        index += 2
    else:
        hr = data[index]
        index += 1
    if flags & 0x08:  # energy expended
        index += 2
    rrs: list[float] = []
    if flags & 0x10:
        while index + 1 < len(data):
            rrs.append(int.from_bytes(data[index : index + 2], "little") / 1024)
            index += 2
    return hr, rrs


def rmssd(rr_seconds: list[float]) -> float | None:
    if len(rr_seconds) < 2:
        return None
    diffs = [(rr_seconds[i] - rr_seconds[i - 1]) * 1000 for i in range(1, len(rr_seconds))]
    return math.sqrt(sum(item * item for item in diffs) / len(diffs))


class PolarDriver(SensorDriver):
    async def run(self) -> None:
        try:
            import bleak  # noqa: F401
        except ImportError:
            log.warning("bleak is not installed; Polar falls back to simulation")
            return
        log.warning("POLAR_ADDRESS is not set; Polar driver stays idle")
        while self._running:
            await asyncio.sleep(30)
