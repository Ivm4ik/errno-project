from scoring.status_machine import StatusMachine

CFG = {"T_WARN": 15, "T_CRIT": 40, "T_SINGLE": 35, "N_RESET": 3, "N_CLEAR": 6}


def row(penalty: float, metric: str = "HR") -> list[dict]:
    return [{"metric": metric, "penalty": penalty}]


def test_thresholds():
    machine = StatusMachine()
    assert machine.step(0, row(10), {"HR": 0}, CFG)["status"] == 0
    assert machine.step(5, row(20), {"HR": 0}, CFG)["status"] == 1
    assert machine.step(10, row(40), {"HR": 0}, CFG)["status"] == 2
    other = StatusMachine()
    assert other.step(0, row(35), {"HR": 0}, CFG)["status"] == 2


def test_three_notices_then_hysteresis():
    machine = StatusMachine()
    cool = {"HR": 0}
    assert machine.step(0, row(20), cool, CFG)["status"] == 1
    assert machine.step(5, row(20), cool, CFG)["status"] == 1
    assert machine.step(10, row(20), cool, CFG)["status"] == 1
    entered = machine.step(15, row(20), cool, CFG)
    assert entered["status"] == 2 and entered["reason"] == "3_notices"
    for index in range(5):
        assert machine.step(20 + index, row(0), cool, CFG)["status"] == 2
    left = machine.step(30, row(0), cool, CFG)
    assert left["status"] == 0 and left["reason"] == "hysteresis"


def test_notice_respects_cooldown_and_reset():
    machine = StatusMachine()
    cool = {"BP": 300}
    machine.step(0, row(20, "BP"), cool, CFG)
    first = machine.step(5, row(20, "BP"), cool, CFG)
    assert first["notice"] == "BP" and machine.notice_count == 1
    assert machine.step(10, row(20, "BP"), cool, CFG)["notice"] is None
    assert machine.step(305, row(20, "BP"), cool, CFG)["notice"] == "BP"
    machine.step(310, row(0, "BP"), cool, CFG)
    machine.step(315, row(0, "BP"), cool, CFG)
    cleared = machine.step(320, row(0, "BP"), cool, CFG)
    assert cleared["status"] == 0
    assert machine.notice_count == 0
