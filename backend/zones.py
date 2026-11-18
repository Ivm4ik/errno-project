"""Per-value highlight only. Status decisions come from penalties, not from these bands.

Glucose is mg/dL. The old mmol/L bands were converted once in metrics.yaml and the limits seed.
"""

from scoring.validate import FORM_PENDING, is_fault, validate_sensor_data


def zone(sensor: str, value: float | None) -> str | None:
    status = validate_sensor_data(sensor, value)
    # No clinical band for equipment faults or unsubmitted forms.
    if value is None or is_fault(status) or status == FORM_PENDING:
        return None
    if sensor == "hr":
        if value < 50 or value > 120:
            return "red"
        if value < 60 or value > 100:
            return "yellow"
        return "green"
    if sensor == "resp":
        if value < 10 or value > 24:
            return "red"
        if value < 12 or value > 20:
            return "yellow"
        return "green"
    if sensor == "spo2":
        if value <= 90:
            return "red"
        if value < 95:
            return "yellow"
        return "green"
    if sensor == "bp_sys":
        if value < 90 or value >= 140:
            return "red"
        if value > 120:
            return "yellow"
        return "green"
    if sensor == "temp":
        if value < 35.5 or value >= 38:
            return "red"
        if value < 36.1 or value > 37.2:
            return "yellow"
        return "green"
    if sensor == "glucose":
        if value < 55 or value > 125:
            return "red"
        if value < 70 or value > 99:
            return "yellow"
        return "green"
    if sensor == "k":
        if value < 3.2 or value >= 5.5:
            return "red"
        if value < 3.5 or value > 5.0:
            return "yellow"
        return "green"
    if sensor == "na":
        if value < 130 or value > 150:
            return "red"
        if value < 135 or value > 145:
            return "yellow"
        return "green"
    if sensor == "ca":
        if value <= 8.0 or value > 10.8:
            return "red"
        if value < 8.5 or value > 10.2:
            return "yellow"
        return "green"
    if sensor == "lactate":
        if value >= 4:
            return "red"
        if value > 2.2 or value < 0.5:
            return "yellow"
        return "green"
    if sensor == "icp":
        if value > 20:
            return "red"
        if value > 15 or value < 7:
            return "yellow"
        return "green"
    if sensor == "sleep_hours":
        if value < 5:
            return "red"
        if value < 6.5 or value > 8.5:
            return "yellow"
        return "green"
    if sensor == "eeg":
        if value > 70:
            return "red"
        if value > 40 or value < 0:
            return "yellow"
        return "green"
    if sensor == "radiation_dose_rate":
        if value > 1.5:
            return "red"
        if value >= 0.5:
            return "yellow"
        return "green"
    if sensor == "co2":
        if value > 1.0:
            return "red"
        if value >= 0.5:
            return "yellow"
        return "green"
    return None
