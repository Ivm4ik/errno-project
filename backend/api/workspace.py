from fastapi import APIRouter, HTTPException, Request

from ctx import active_ws
from workspace import manager

router = APIRouter()

# The browser generator stops by itself after this many seconds. Shown in the UI, enforced there.
MAX_RUN_SEC = 600


@router.get("/workspace")
async def info(request: Request) -> dict:
    """Describe the sandbox that answers this request."""
    ws = active_ws.get() or manager.default
    return {
        "id": None if ws is None or ws.is_default else ws.id,
        "isolated": bool(ws is not None and not ws.is_default),
        "demo": bool(request.app.state.demo),
        "ttl_sec": manager.ttl,
        "max_run_sec": MAX_RUN_SEC,
        "signal_delay_sec": request.app.state.delay,
    }


@router.delete("/workspace")
async def reset(request: Request) -> dict:
    """Throw the sandbox away and start a fresh one under the same id."""
    ws = active_ws.get()
    if ws is None or ws.is_default or ws.id is None:
        raise HTTPException(400, "Only a demo workspace can be reset")
    await manager.reset(ws.id)
    return {"ok": True}
