import asyncio

from clock import now
from sensors.base import SensorDriver


class PushDriver(SensorDriver):
    """Watch a push metric. 30 s of silence raises an equipment mark. No synthetic fill."""

    def __init__(self, metric_cfg, astronaut_id, out_queue, seen: dict) -> None:
        super().__init__(metric_cfg, astronaut_id, out_queue)
        self.seen = seen
        self._flagged = False

    async def run(self) -> None:
        while self._running:
            await asyncio.sleep(1)
            key = (self.astronaut_id, self.metric_cfg["id"])
            last = self.seen.get(key)
            t = now()
            if last is None or t - last < 30:
                if last is not None and t - last < 30:
                    self._flagged = False
                continue
            if not self._flagged:
                self.out_queue.put_nowait(("silence", self.astronaut_id, self.metric_cfg["id"], last, t))
                self._flagged = True
