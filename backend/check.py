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
json.dumps(s), json.dumps(x), json.dumps(e.station_detail("P3"))
print("JSON ок")
