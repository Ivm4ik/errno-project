import math


def update(mean: float, var: float, n: int, value: float, alpha: float) -> tuple[float, float, int]:
    if n <= 0:
        return value, 0.0, 1
    delta = value - mean
    mean = mean + alpha * delta
    var = (1 - alpha) * (var + alpha * delta * delta)
    return mean, max(0.0, var), n + 1


def zscore(mean: float, var: float, value: float) -> float:
    floor = max(abs(mean) * 0.01, 1e-9)
    std = max(math.sqrt(var), floor)
    return (value - mean) / std
