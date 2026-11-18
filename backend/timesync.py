from collections import deque
from statistics import median


class TimeSync:
    """Offset is the median of the last 20 live (not buffered) arrivals."""

    def __init__(self) -> None:
        self._samples: dict[str, deque[float]] = {}

    def correct(self, device_id: str, ts_device: float | None, buffered: bool, arrival: float) -> float:
        if ts_device is None:
            return arrival
        bucket = self._samples.setdefault(device_id, deque(maxlen=20))
        if not buffered:
            bucket.append(arrival - ts_device)
        offset = median(bucket) if bucket else 0.0
        return ts_device + offset
