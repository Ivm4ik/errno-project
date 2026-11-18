import importlib.util
import logging

from config_loader import metric_source

log = logging.getLogger(__name__)

PUSH = {"esp32"}


def resolve(metric: dict) -> str:
    source = metric_source(metric)
    if source in {"sim", "device"}:
        return "device"
    if source == "form" or source == "manual":
        return source
    if source == "polar":
        if importlib.util.find_spec("bleak") is None:
            log.warning("bleak missing; %s waits for a device", metric["id"])
            return "device"
        return "polar"
    if source == "brainflow":
        if importlib.util.find_spec("brainflow") is None:
            log.warning("brainflow missing; %s waits for a device", metric["id"])
            return "device"
        return "brainflow"
    if source in PUSH:
        return source
    log.warning("Unknown source %s for %s; leaving it as device input", source, metric["id"])
    return "device"
