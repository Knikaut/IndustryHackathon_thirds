"""Показатели: смена, период, панель руководителя."""

from collections import defaultdict
from datetime import datetime, timedelta

from . import layout as L
from .store import (BLOCKED, DEFECTS, DOWN, PLANNED, RUN, SIDS, STARVED, TICKS,
                    UNITS, Store)

LAST = len(SIDS) - 1


def shift_of(ts: datetime):
    """Две смены по 8 часов: первая 08–16, вторая 16–24. Ночью остаётся итог второй смены."""
    day = ts.replace(minute=0, second=0, microsecond=0)
    (h1, n1), (h2, n2) = L.SHIFTS
    if ts.hour >= h2:
        start, name = day.replace(hour=h2), n2
    elif ts.hour >= h1:
        start, name = day.replace(hour=h1), n1
    else:
        start, name = (day - timedelta(days=1)).replace(hour=h2), n2
    return name, start, start + timedelta(hours=L.SHIFT_HOURS)


def month_outlook(store: Store, now: datetime) -> dict:
    """Выпуск с начала месяца, прогноз до конца месяца и выпуск по моделям."""
    first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    nxt = (first + timedelta(days=32)).replace(day=1)
    fact = worked = 0
    for h in store.hours_between(first, now):
        last = store.hourly[h][LAST]
        fact += last[UNITS]
        worked += (last[TICKS] - last[PLANNED]) / 12
    day_hours = L.SHIFT_HOURS * len(L.SHIFTS)
    total = sum(day_hours for d in range((nxt - first).days) if (first + timedelta(days=d)).weekday() < 5)
    rate = fact / worked if worked else 0.0
    by_model = {}
    for day, counts in store.models.items():
        if first.date() <= day <= now.date():
            for m, k in counts.items():
                by_model[m] = by_model.get(m, 0) + k
    return dict(plan=L.MONTH_PLAN, fact=fact, hours_worked=worked, hours_total=total,
                work_days=round(total / day_hours), shift_plan_total=round(L.PLAN_PER_HOUR * total),
                projected=round(fact + rate * max(0.0, total - worked)), per_hour=rate,
                models=[dict(model=m, plan=p, fact=by_model.get(m, 0)) for m, p in L.MODELS])


def _ratio(a, b, default=0.0):
    return a / b if b else default


def period_kpi(store: Store, hours) -> dict:
    """Сводные показатели линии и постов за набор часов."""
    tot = [[0] * 8 for _ in SIDS]
    for h in hours:
        for i, a in enumerate(store.hourly[h]):
            row = tot[i]
            for k in range(8):
                row[k] += a[k]

    sched_line = tot[LAST][TICKS] - tot[LAST][PLANNED]
    ideal = L.NOMINAL_PER_HOUR / 12 * sched_line
    plan = L.PLAN_PER_HOUR / 12 * sched_line
    fact = tot[LAST][UNITS]

    sched_sum = sum(r[TICKS] - r[PLANNED] for r in tot)
    down_sum = sum(r[DOWN] for r in tot)
    run_sum = sum(r[RUN] for r in tot)
    fpy = 1.0
    stations = {}
    for sid, r in zip(SIDS, tot):
        sched = r[TICKS] - r[PLANNED]
        q = 1 - _ratio(r[DEFECTS], r[UNITS])
        fpy *= q
        nominal = 300 / L.STATION_BY_ID[sid]["cycle_s"]
        a = 1 - _ratio(r[DOWN], sched)
        p = min(1.0, _ratio(r[UNITS], r[RUN] * nominal))
        stations[sid] = dict(
            units=r[UNITS], defects=r[DEFECTS], fpy=q, availability=a, performance=p,
            oee=_ratio(r[RUN], sched) * p * q,
            load=_ratio(r[RUN], sched), downtime_min=r[DOWN] * 5,
            starved_min=r[STARVED] * 5, blocked_min=r[BLOCKED] * 5,
        )

    a_line = 1 - _ratio(down_sum, sched_sum)
    oee = _ratio(fact * fpy, ideal)
    return dict(
        plan=round(plan), fact=fact, ideal=round(ideal),
        oee=oee, availability=a_line, quality=fpy,
        performance=min(1.0, _ratio(oee, a_line * fpy)),
        load=_ratio(run_sum, sched_sum),
        downtime_min=down_sum * 5, defects=sum(r[DEFECTS] for r in tot),
        sched_hours=sched_line / 12, stations=stations,
    )


def executive(store: Store, now: datetime, days: int) -> dict:
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    by_day = defaultdict(list)
    for h in store.hours_between(start, now):
        by_day[h.date()].append(h)

    daily = []
    for d in sorted(by_day):
        k = period_kpi(store, by_day[d])
        if not k["sched_hours"]:   # выходной: на графиках его нет
            continue
        daily.append(dict(date=d.isoformat(), plan=k["plan"], fact=k["fact"], oee=k["oee"],
                          availability=k["availability"], performance=k["performance"],
                          quality=k["quality"], downtime_min=k["downtime_min"]))

    all_hours = [h for hs in by_day.values() for h in hs]
    total = period_kpi(store, all_hours)

    cause_min, shop_min = defaultdict(int), defaultdict(int)
    st_min, st_cnt = defaultdict(int), defaultdict(int)
    equip_min = 0
    for ev in store.events:
        if ev["start"] < start:
            continue
        cause_min[ev["cause"]] += ev["minutes"]
        shop_min[ev["shop"]] += ev["minutes"]
        st_min[ev["station"]] += ev["minutes"]
        st_cnt[ev["station"]] += 1
        if ev["cause"] in L.EQUIP_CAUSES:
            equip_min += ev["minutes"]

    stations = []
    for sid in SIDS:
        s, spec = total["stations"][sid], L.STATION_BY_ID[sid]
        n = st_cnt[sid]
        run_h = total["sched_hours"] * s["load"]
        stations.append(dict(
            id=sid, name=spec["name"], shop=spec["shop"], downtime_min=st_min[sid], failures=n,
            mtbf_h=_ratio(run_h, n) if n else None, mttr_min=_ratio(st_min[sid], n) if n else None,
            oee=s["oee"], fpy=s["fpy"], defects=s["defects"], load=s["load"],
        ))

    shops = []
    for shop in L.SHOPS:
        ss = [s for s in stations if s["shop"] == shop["id"]]
        fpy = 1.0
        for s in ss:
            fpy *= s["fpy"]
        shops.append(dict(id=shop["id"], name=shop["name"], downtime_min=shop_min[shop["id"]],
                          failures=sum(s["failures"] for s in ss),
                          oee=sum(s["oee"] for s in ss) / len(ss), fpy=fpy, defect_rate=1 - fpy,
                          defects=sum(s["defects"] for s in ss)))

    pareto = sorted(({"cause": c, "minutes": m} for c, m in cause_min.items()),
                    key=lambda x: -x["minutes"])
    span_days = max(1, len(by_day))
    return dict(
        days=span_days, total={k: v for k, v in total.items() if k != "stations"},
        daily=daily, pareto=pareto, shops=shops, stations=stations,
        equip_downtime_h=equip_min / 60,
        units_per_hour=_ratio(total["fact"], total["sched_hours"]),
        shortfall=max(0, total["plan"] - total["fact"]),
        month=month_outlook(store, now),
    )
