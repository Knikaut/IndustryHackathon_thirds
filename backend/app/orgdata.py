"""Тестовые данные организаторов (data/test_data.docx).

Документ содержит четыре таблицы и нормативы. Здесь он читается как есть и
сверяется с нормативами. Данных мало (два дня, три линии), поэтому поток событий
двойника остаётся синтетическим, а из документа берутся режим работы, темп,
нормы, уровень брака по участкам, названия оборудования и причин простоев.
"""

import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

from . import layout as L

DOCX = Path(__file__).resolve().parents[2] / "data" / "test_data.docx"
_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def _num(s: str) -> float:
    return float(s.replace(",", ".").replace(" ", ""))


def _tables(path: Path):
    body = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml")).find(_W + "body")
    text = lambda el: "".join(t.text or "" for t in el.iter(_W + "t")).strip()
    return [[[text(tc) for tc in tr.findall(_W + "tc")] for tr in tbl.iter(_W + "tr")]
            for tbl in body.iter(_W + "tbl")]


def load() -> dict | None:
    if not DOCX.exists():
        return None
    lines_t, down_t, plan_t, qual_t = _tables(DOCX)[:4]
    lines = [dict(date=r[0], line=r[1], plan=int(r[2]), fact=int(r[3]), hours=_num(r[4]), load=_num(r[5]))
             for r in lines_t[1:]]
    downtime = [dict(date=r[0], shop=r[1], equipment=r[2], cause=r[3], minutes=int(r[4])) for r in down_t[1:]]
    models = [dict(model=r[0], plan=int(r[1])) for r in plan_t[1:]]
    quality = [dict(date=r[0], shop=r[1], made=int(r[2]), defects=int(r[3]), rate=_num(r[4]) / 100)
               for r in qual_t[1:]]

    # оценка OEE линии за смену: готовность (часы из 8) × темп к плановому × доля годных
    q = {(r["date"], r["shop"]): r["rate"] for r in quality}
    for r in lines:
        shop = r["line"].split("-")[0]
        a = r["hours"] / L.SHIFT_HOURS
        p = min(1.0, (r["fact"] / r["hours"]) / (r["plan"] / L.SHIFT_HOURS)) if r["hours"] else 0.0
        rate = q.get((r["date"], shop))
        r.update(done=r["fact"] / r["plan"], defect=rate, oee=a * p * (1 - (rate or 0)))

    by_equipment = defaultdict(int)
    for d in downtime:
        by_equipment[(d["date"], d["equipment"])] += d["minutes"]
    worst = max(by_equipment.items(), key=lambda kv: kv[1])
    over = [r for r in quality if r["rate"] > L.DEFECT_LIMIT]
    low_oee = [r for r in lines if r["oee"] < L.OEE_TARGET]
    behind = [r for r in lines if r["fact"] < r["plan"]]
    models_total = sum(m["plan"] for m in models)
    checks = [
        dict(ok=not over, title="Брак не более 2 %",
             text=("Норма выдержана на всех участках." if not over else
                   "Превышение: " + "; ".join(f"{r['shop']} {r['date'][:5]} — " + f"{r['rate'] * 100:.1f}".replace(".", ",") + " %" for r in over) + ".")),
        dict(ok=worst[1] <= L.DOWNTIME_LIMIT_MIN, title="Простой оборудования не более 60 минут в сутки",
             text=f"Наибольший простой: {worst[0][1]} {worst[0][0][:5]} — {worst[1]} мин."),
        dict(ok=not low_oee, title="OEE не менее 85 %",
             text=("По оценке двойника все линии выше цели: от "
                   f"{min(r['oee'] for r in lines) * 100:.0f} до {max(r['oee'] for r in lines) * 100:.0f} %." if not low_oee else
                   "Ниже цели: " + "; ".join(f"{r['line']} {r['date'][:5]} — {r['oee'] * 100:.0f} %" for r in low_oee) + ".")),
        dict(ok=not behind, title="Выполнение сменного плана",
             text=("План выполнен на всех линиях." if not behind else
                   "Отставание: " + "; ".join(f"{r['line']} {r['date'][:5]} — {r['fact']} из {r['plan']}" for r in behind) + ".")),
        dict(ok=models_total >= L.MONTH_PLAN, title="План выпуска не менее 5 500 автомобилей в месяц",
             text=f"План по моделям в сумме даёт {models_total}, это на {L.MONTH_PLAN - models_total} меньше минимума из вводных."),
    ]
    return dict(
        file=DOCX.name, lines=lines, downtime=downtime, models=models, quality=quality, checks=checks,
        assumptions=[
            "Строки таблицы линий относятся к одной смене: 120 автомобилей за 8 часов. Две смены дают 240 в сутки; план 5 500 в месяц при таком темпе требует около 23 рабочих дней.",
            "Режим двойника: понедельник–пятница, смены 08:00–16:00 и 16:00–24:00, в субботу плановое ТО. Дни недели в документе не указаны, это допущение.",
            "Телеметрии оборудования в данных нет, поэтому модель прогноза отказов обучена на синтетической телеметрии.",
        ],
    )
