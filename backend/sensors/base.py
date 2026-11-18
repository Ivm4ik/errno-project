from abc import ABC, abstractmethod


class SensorDriver(ABC):
    def __init__(self, metric_cfg: dict, astronaut_id: str, out_queue) -> None:
        self.metric_cfg = metric_cfg
        self.astronaut_id = astronaut_id
        self.out_queue = out_queue
        self._running = True

    @abstractmethod
    async def run(self) -> None: ...

    async def stop(self) -> None:
        self._running = False
