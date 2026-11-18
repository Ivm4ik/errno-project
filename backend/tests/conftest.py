import os
import tempfile
from pathlib import Path

_tmp = Path(tempfile.mkdtemp())
_db = _tmp / "test.db"
os.environ["DATABASE_PATH"] = str(_db)
os.environ["DATA_DIR"] = str(_tmp / "data")
os.environ["RUN_DRIVERS"] = "false"
os.environ["DEV_NO_AUTH"] = "true"
os.environ["DEMO_MODE"] = "true"
os.environ["DEVICE_TOKENS"] = "gw-1:secret,sim-gw-1:secret"
os.environ["FLUSH_SECONDS"] = "0.05"
os.environ["SIGNAL_DELAY_SEC"] = "0"
