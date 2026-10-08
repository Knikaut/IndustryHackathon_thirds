"""Быстрая проверка движка без сервера: python check.py"""

import json
import time

from app.engine import Engine

t0 = time.time()
e = Engine()
print(f"запуск: {time.time() - t0:.1f} c, тактов истории: {len(e.store)}")
print("модель:", json.dumps({k: v for k, v in e.model.metrics.items() if k != "features"}, ensure_ascii=False, indent=1))

t0 = time.time()
for _ in range(100):
    e.tick()
print(f"такт: {(time.time() - t0) * 10:.1f} мс")

s = e.snapshot
print("смена:", s["shift"]["name"], {k: s["kpi"][k] for k in ("plan", "fact", "oee", "availability", "performance", "quality", "load", "downtime_min")})
print("риски:", [(f["station"], f["risk"]) for f in s["forecast"]])
print("узкое место:", s["bottleneck"])
print("инцидентов:", len(s["incidents"]), "открытых:", sum(i["open"] for i in s["incidents"]))
x = e.executive(30)
print("30 дней:", {k: round(v, 3) if isinstance(v, float) else v for k, v in x["total"].items()})
print("парето:", x["pareto"])
print("простои оборудования, ч:", round(x["equip_downtime_h"], 1), "недовыпуск:", x["shortfall"])
json.dumps(e.state(), allow_nan=False), json.dumps(x, allow_nan=False), json.dumps(e.station_detail("P3"), allow_nan=False)
print("JSON ок")

# инварианты на трёх неделях модели: переходы через ночь и выходные
from app.sim import Simulator  # noqa: E402

t0, longest = time.time(), 0.0
for _ in range(3000):
    t1 = time.time()
    e.tick()
    longest = max(longest, time.time() - t1)
    k = e.snapshot["kpi"]
    assert Simulator.mode(e.clock) == "work", f"снимок в нерабочее время: {e.clock}"
    assert k["oee"] <= 1.0, f"OEE выше 100 %: {k['oee']} в {e.clock}"
    assert abs(k["oee"] - k["availability"] * k["performance"] * k["quality"]) < 2e-4, f"OEE не равен A x P x Q в {e.clock}"
json.dumps(e.state(), allow_nan=False)
print(f"3000 тактов до {e.clock:%d.%m %H:%M}: {time.time() - t0:.1f} c, самый долгий такт (с перемоткой выходных) {longest * 1000:.0f} мс; OEE и рабочее время ок")

# сценарий показа: после «Ускорить износ» пост не встаёт случайно, пока прогноз не успеет предупредить
from app.sim import GRACE  # noqa: E402

for sid in ("W3", "A2", "F1"):
    e.sim.repair(sid)
    e.sim.degrade(sid, 0.42)
    for _ in range(GRACE):
        e.tick()
        assert e.store.open_event(sid) is None, f"{sid} встал на отсрочке после «Ускорить износ» в {e.clock}"
print(f"сценарий «Ускорить износ»: тактов без случайной остановки — {GRACE}, ок")
