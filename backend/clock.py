"""Wall clock for human actions. Simulated time arrives as packet timestamps."""

import time


def now() -> float:
    return time.time()


def wall() -> float:
    return time.time()
