from clock import now
from models import Reading


def lab(astronaut_id: str, sensor_id: str, value: float, unit: str) -> Reading:
    return Reading(sensor_id=sensor_id, astronaut_id=astronaut_id, value=value, unit=unit, ts=now(), source="manual")
