import contextlib
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import alerts, audit, auth, forms, ingest, live, mission, readings, sensors, status
from api import workspace as workspace_api
from clock import now
from config_loader import env_bool
from workspace import StateProxy, WorkspaceMiddleware, manager

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
log = logging.getLogger("errno")


def _mqtt_task(url: str, queue, metrics_by_id: dict):
    try:
        import paho.mqtt.client as mqtt
    except ImportError:
        log.warning("paho-mqtt is not installed; MQTT bridge is off")
        return None

    def on_message(_client, _userdata, msg):
        parts = msg.topic.split("/")
        if len(parts) != 3 or parts[0] != "health":
            return
        _, astronaut, sensor = parts
        metric = metrics_by_id.get(sensor)
        if metric is None:
            return
        try:
            value = float(msg.payload)
        except ValueError:
            return
        from models import Reading

        queue.put_nowait(
            Reading(
                sensor_id=sensor,
                astronaut_id=astronaut,
                value=value,
                unit=metric["unit"],
                ts=now(),
                source="esp32",
            )
        )

    client = mqtt.Client()
    client.on_message = on_message
    client.connect(url.split("://")[-1].split(":")[0], int(url.rsplit(":", 1)[-1]) if ":" in url.split("://")[-1] else 1883)
    client.subscribe("health/+/+")
    client.loop_start()
    return client


@asynccontextmanager
async def lifespan(app: FastAPI):
    if env_bool("DEV_NO_AUTH", False):
        log.warning("DEV_NO_AUTH is on. Ingest accepts requests with no device token.")
    default = await manager.start()
    mqtt = _mqtt_task(os.environ.get("MQTT_URL", ""), default.queue, default.metrics_by_id) if os.environ.get("MQTT_URL") else None
    try:
        yield
    finally:
        if mqtt is not None:
            with contextlib.suppress(Exception):
                mqtt.loop_stop()
        await manager.stop()


app = FastAPI(title="ERRNO", version="2.0.0", lifespan=lifespan)
# Every attribute of app.state now comes from the sandbox that owns the request.
app.state = StateProxy()  # type: ignore[assignment]

app.add_middleware(WorkspaceMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        *[o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()],
    ],
    # e.g. https://.*\.vercel\.app to accept Vercel preview deployments.
    allow_origin_regex=os.environ.get("CORS_ORIGIN_REGEX") or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
for piece in (
    auth.router,
    workspace_api.router,
    ingest.router,
    forms.router,
    readings.router,
    status.router,
    alerts.router,
    audit.router,
    live.router,
    mission.router,
    sensors.router,
):
    app.include_router(piece)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8000")), reload=False)
