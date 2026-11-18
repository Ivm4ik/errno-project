"""Per-request context. Set by the workspace middleware, read by db.connect() and the state proxy."""

from contextvars import ContextVar
from pathlib import Path

# Database file of the sandbox that owns the current request. None means the default database.
active_db: ContextVar[Path | None] = ContextVar("errno_active_db", default=None)
# The Workspace object that owns the current request. None means "use the default workspace".
active_ws: ContextVar[object | None] = ContextVar("errno_active_ws", default=None)
