from pydantic import BaseModel, Field


class Reading(BaseModel):
    sensor_id: str
    astronaut_id: str
    value: float
    unit: str
    ts: float | None = None
    quality: float = 1.0
    source: str = "device"
    device_id: str | None = None
    seq: int | None = None
    ts_device: float | None = None
    activity_mode: str | None = None


class IngestReading(BaseModel):
    sensor_id: str
    value: float
    unit: str = ""
    quality: float = 1.0
    ts_device: float | None = None
    astronaut_id: str | None = None


class Envelope(BaseModel):
    device_id: str
    astronaut_id: str
    seq: int | None = None
    buffered: bool = False
    ts_device: float | None = None
    activity_mode: str = "rest"
    time_scale: float = 1
    readings: list[IngestReading] = Field(default_factory=list)
