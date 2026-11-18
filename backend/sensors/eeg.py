import asyncio
import logging

from sensors.base import SensorDriver

log = logging.getLogger(__name__)


class BrainflowEEGDriver(SensorDriver):
    async def run(self) -> None:
        try:
            import brainflow  # noqa: F401
        except ImportError:
            log.warning("brainflow is not installed; EEG falls back to simulation")
            return
        log.warning("No brainflow board configured; EEG driver stays idle")
        while self._running:
            await asyncio.sleep(30)
