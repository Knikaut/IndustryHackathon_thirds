"""Движок двойника: история, живой такт, инциденты, снимок состояния для API."""

import math
from datetime import datetime, timedelta

from . import layout as L
from .forecast import HORIZON_H, THRESHOLD, Forecaster, bottleneck, buffer_outlook, explain
from . import orgdata
from .kpi import executive, period_kpi, shift_of
from .sim import Simulator
from .store import SIDS, Store

TICK = timedelta(minutes=5)


def num(x, nd=2):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    return round(x, nd)


def iso(ts):
    return ts.isoformat(timespec="minutes") if ts else None


class Engine:
    def __init__(self, days: int = 75, seed: int = 7):
        self.sim = Simulator(seed)
        self.store = Store()
        self.org = orgdata.load()
        now = datetime.now().replace(second=0, microsecond=0)
        now -= timedelta(minutes=now.minute % 5)
        # вне смены показывать нечего: модель стартует с начала ближайшей прошедшей смены
        if Simulator.mode(now) != "work":
            day = now - timedelta(days=1) if now.hour < L.SHIFTS[0][0] else now
            while day.weekday() >= 5:
                day -= timedelta(days=1)
            now = day.replace(hour=L.SHIFTS[0][0] + 1, minute=0)
        t = now - timedelta(days=days)
        while t < now:
            self._ingest(t)
            t += TICK
        self.clock = now - TICK
        self.started = now

        self.model = Forecaster(self.store)
        self.model.train()

        # риск за последние сутки истории, чтобы графики не начинались с пустоты
        n = len(self.store)
        self.risk_offset = n - 288
        self.risk, self.feats = {}, {}
        for t in range(self.risk_offset, n):
            self._score(t)

        self.tick_seconds = 2.0
        self.paused = False
        self.alerts: dict[tuple, dict] = {}
        self.closed: list[dict] = []
        self._alert_seq = 0
        self._exec_cache = {}
        self.snapshot = {}
        self._update_alerts()
        self.snapshot = self._build()

    # --- такт ----------------------------------------------------------
    def _score(self, t=None):
        p, F = self.model.predict(t)
        for sid in SIDS:
            prev = self.risk.get(sid, p[sid])
            self.risk[sid] = 0.5 * prev + 0.5 * p[sid]
            self.store.series[sid].risk.append(self.risk[sid])
        self.feats = F

    def _ingest(self, t):
        rows, buf = self.sim.step(t)
        self.store.ingest(t, rows, buf)
        self.store.add_models(t, self.sim.last_models)

    def tick(self):
        self.clock += TICK
        self._ingest(self.clock)
        self._score()
        # нерабочие часы проматываются: ночью на заводе ничего не происходит
        while Simulator.mode(self.clock + TICK) == "off":
            self.clock += TICK
            self._ingest(self.clock)
            self._score()
        self._update_alerts()
        self.snapshot = self._build()

    # --- инциденты и отклонения ----------------------------------------
    def _raise(self, key, **fields):
        a = self.alerts.get(key)
        if a is None:
            self._alert_seq += 1
            a = self.alerts[key] = dict(id=f"A{self._alert_seq}", type=key[0], station=key[1],
                                        start=self.clock, end=None, outcome=None)
        a.update(fields)

    def _clear(self, key, outcome=None):
        a = self.alerts.pop(key, None)
        if a:
            a["end"], a["outcome"] = self.clock, outcome
            self.closed.append(a)
            del self.closed[:-60]

    def _update_alerts(self):
        store, n = self.store, len(self.store)
        for sid in SIDS:
            spec = L.STATION_BY_ID[sid]
            s = store.series[sid]
            risk, key = self.risk[sid], ("forecast", sid)
            ev = store.open_event(sid)
            if ev and key in self.alerts:
                self._clear(key, "confirmed" if ev["cause"] in L.EQUIP_CAUSES else None)
            elif not ev and risk >= THRESHOLD:
                factors, action = explain(self.feats[sid], spec["kind"])
                lead = factors[0]["label"].lower() + " " + factors[0]["value"] if factors else "совокупность сигналов"
                self._raise(key, severity="warning", shop=spec["shop"],
                            title=f"Риск отказа: {spec['name']}",
                            detail=f"{risk:.0%} в ближайшие {HORIZON_H} ч · {lead}", action=action)
            elif key in self.alerts and risk < 0.1:
                self._clear(key)

            # норматив организаторов: простой оборудования не более 60 минут в сутки
            day_min, key = store.downtime_today(sid, self.clock), ("limit", sid)
            if day_min > L.DOWNTIME_LIMIT_MIN:
                self._raise(key, severity="critical", shop=spec["shop"],
                            title=f"Простой за сутки выше нормы: {spec['name']}",
                            detail=f"{day_min} мин при допустимых {L.DOWNTIME_LIMIT_MIN} · {spec['asset']}",
                            action="Разобрать причины простоев за сутки, усилить дежурство ремонтной службы")
            elif key in self.alerts:
                self._clear(key)

        name, start, _ = shift_of(self.clock)
        k = period_kpi(store, store.hours_between(start, self.clock))

        # норматив организаторов: брак участка за смену не более 2 %
        for shop in L.SHOPS:
            ids = [sid for sid in SIDS if L.STATION_BY_ID[sid]["shop"] == shop["id"]]
            made = k["stations"][ids[-1]]["units"]
            defects = sum(k["stations"][sid]["defects"] for sid in ids)
            rate, key = defects / made if made else 0.0, ("quality", shop["id"])
            if made >= 50 and defects >= 3 and rate > L.DEFECT_LIMIT:
                worst = max(ids, key=lambda sid: k["stations"][sid]["defects"])
                self._raise(key, severity="warning", shop=shop["id"], station=worst,
                            title=f"Брак выше нормы: {shop['name'].lower()}",
                            detail=f"{defects} из {made} за смену, {rate:.1%} при допустимых {L.DEFECT_LIMIT:.0%}",
                            action=f"Больше всего дефектов даёт пост {worst} · {L.STATION_BY_ID[worst]['name']}: сверить параметры процесса")
            elif key in self.alerts and (made < 50 or rate <= L.DEFECT_LIMIT * 0.9):
                self._clear(key)
        key = ("plan", "LINE")
        if k["sched_hours"] >= 1 and k["fact"] < 0.9 * k["plan"]:
            self._raise(key, severity="warning", shop=None, title="Отставание от плана смены",
                        detail=f"Факт {k['fact']} из {k['plan']} ед. к этому часу ({k['fact'] / k['plan']:.0%})",
                        action="Проверить узкое место и простои текущей смены")
        elif key in self.alerts and k["fact"] >= 0.95 * k["plan"]:
            self._clear(key)

        for b in L.BUFFERS:
            level = store.buf[n - 1][SIDS.index(b["after"])]
            fill, key = level / b["cap"], ("buffer", b["id"])
            if fill >= 0.9:
                self._raise(key, severity="warning", shop=L.STATION_BY_ID[b["after"]]["shop"],
                            title=f"Накопитель заполнен: {b['name'].lower()}",
                            detail=f"{level} из {b['cap']} мест: предыдущий цех скоро встанет",
                            action="Ускорить следующий цех или снизить темп предыдущего")
            elif fill <= 0.1:
                self._raise(key, severity="warning", shop=L.STATION_BY_ID[b["after"]]["shop"],
                            title=f"Накопитель пуст: {b['name'].lower()}",
                            detail=f"{level} из {b['cap']} мест: следующий цех скоро останется без кузовов",
                            action="Проверить выпуск предыдущего цеха")
            elif key in self.alerts and 0.2 < fill < 0.8:
                self._clear(key)

        self.bn = bottleneck(store)
        for key in [k for k in self.alerts if k[0] == "bottleneck" and (not self.bn or k[1] != self.bn["station"])]:
            self._clear(key)
        if self.bn:
            self._raise(("bottleneck", self.bn["station"]), severity="warning", shop=self.bn["shop"],
                        title=f"Узкое место: {self.bn['name']}", detail=self.bn["reason"].capitalize(),
                        action="Перераспределить ресурсы на пост, проверить причину замедления")

    def _incidents(self):
        since = self.clock - timedelta(hours=24)
        items = []
        for ev in reversed(self.store.events):
            if ev["start"] < since - timedelta(hours=6):
                break
            if ev["end"] and ev["end"] < since:
                continue
            spec = L.STATION_BY_ID[ev["station"]]
            is_open = ev["end"] is None
            items.append(dict(
                id=f"D{ev['id']}", type="downtime", station=ev["station"], shop=ev["shop"],
                severity="critical" if is_open or ev["minutes"] >= 30 else "warning",
                title=f"Простой: {spec['name']}", detail=f"{ev['cause']} · {ev['minutes']} мин",
                action=None, start=iso(ev["start"]), end=iso(ev["end"]), open=is_open, outcome=None))
        for a in list(self.alerts.values()) + [c for c in self.closed if c["end"] >= since]:
            items.append({**a, "start": iso(a["start"]), "end": iso(a["end"]), "open": a["end"] is None})
        items.sort(key=lambda x: (not x["open"], x["start"]), reverse=False)
        open_items = [i for i in items if i["open"]]
        closed = sorted((i for i in items if not i["open"]), key=lambda x: x["start"], reverse=True)
        open_items.sort(key=lambda x: (x["severity"] != "critical", x["start"]))
        return open_items + closed[:40]

    # --- снимок --------------------------------------------------------
    def _build(self):
        store, n = self.store, len(self.store)
        name, start, end = shift_of(self.clock)
        k = period_kpi(store, store.hours_between(start, self.clock))

        stations = []
        for sid in SIDS:
            spec, s, sk = L.STATION_BY_ID[sid], store.series[sid], k["stations"][sid]
            ev = store.open_event(sid)
            risk = self.risk[sid]

            def last(arr):
                for v in reversed(arr[n - 24:n]):
                    if not math.isnan(v):
                        return v
                return None

            stations.append(dict(
                id=sid, state=s.state[-1], cause=ev["cause"] if ev else None,
                down_min=ev["minutes"] if ev else 0,
                units_h=sum(s.units[n - 12:n]), risk=num(risk, 3),
                risk_level="high" if risk >= THRESHOLD else "elevated" if risk >= 0.1 else "low",
                vib=num(last(s.vib)), temp=num(last(s.temp), 1), cur=num(last(s.cur), 1),
                cyc=num(last(s.cyc), 1), load=num(sk["load"], 3), oee=num(sk["oee"], 3),
                fpy=num(sk["fpy"], 4), units=sk["units"], defects=sk["defects"],
                downtime_min=sk["downtime_min"], downtime_day_min=store.downtime_today(sid, self.clock),
            ))

        hourly = []
        h = self.clock.replace(minute=0, second=0, microsecond=0) - timedelta(hours=11)
        for _ in range(12):
            agg = store.hourly.get(h)
            if agg:
                last_row = agg[-1]
                hourly.append(dict(hour=iso(h), fact=last_row[6],
                                   plan=round(L.PLAN_PER_HOUR / 12 * (last_row[0] - last_row[5]))))
            h += timedelta(hours=1)

        forecast = []
        for sid in sorted(SIDS, key=lambda x: -self.risk[x])[:6]:
            spec = L.STATION_BY_ID[sid]
            factors, action = explain(self.feats[sid], spec["kind"])
            forecast.append(dict(station=sid, name=spec["name"], asset=spec["asset"], shop=spec["shop"],
                                 risk=num(self.risk[sid], 3), factors=factors, action=action,
                                 history=[num(v, 3) for v in store.series[sid].risk[-144::6]]))

        return dict(
            clock=iso(self.clock), tick_seconds=self.tick_seconds, paused=self.paused,
            speed=round(300 / self.tick_seconds),
            source=dict(kind="calibrated", label="Модель по данным организаторов",
                        note="Режим, сменный план, нормативы, уровень брака, оборудование и причины простоев взяты из тестовых данных; поток событий синтетический."),
            shift=dict(name=name, start=iso(start), end=iso(end),
                       progress=num(min(1.0, (self.clock - start) / (end - start)), 3),
                       plan_total=L.PLAN_PER_HOUR * L.SHIFT_HOURS),
            targets=dict(oee=L.OEE_TARGET, defect=L.DEFECT_LIMIT, downtime_min=L.DOWNTIME_LIMIT_MIN, month_plan=L.MONTH_PLAN),
            kpi={kk: (num(v, 4) if isinstance(v, float) else v) for kk, v in k.items() if kk != "stations"},
            hourly=hourly, stations=stations, buffers=buffer_outlook(store, None),
            incidents=self._incidents(), forecast=forecast, bottleneck=self.bn,
            horizon_h=HORIZON_H, threshold=THRESHOLD,
        )

    # --- детали поста и панель руководителя ----------------------------
    def station_detail(self, sid: str):
        store, n = self.store, len(self.store)
        spec, s = L.STATION_BY_ID[sid], store.series[sid]
        idx = range(max(0, n - 288), n, 3)
        ro = self.risk_offset
        series = [dict(t=iso(store.ts[i]), vib=num(s.vib[i]), temp=num(s.temp[i], 1),
                       cur=num(s.cur[i], 1), cyc=num(s.cyc[i], 1), state=s.state[i],
                       risk=num(s.risk[i - ro], 3) if i >= ro else None) for i in idx]
        events = [dict(start=iso(e["start"]), end=iso(e["end"]), cause=e["cause"], minutes=e["minutes"])
                  for e in store.events if e["station"] == sid][-8:][::-1]
        factors, action = explain(self.feats[sid], spec["kind"])
        return dict(id=sid, name=spec["name"], asset=spec["asset"], shop=spec["shop"],
                    shop_name=L.SHOP_BY_ID[spec["shop"]]["full"], cycle_s=spec["cycle_s"], op=spec.get("op"),
                    base={k: num(v) for k, v in self.model.base[sid].items()},
                    series=series, events=events, factors=factors, action=action,
                    hours_since_repair=num(store.hours_since_repair(sid, n - 1), 1))

    def executive(self, days: int):
        key = (days, self.clock.replace(minute=0))
        if key not in self._exec_cache:
            self._exec_cache = {key: executive(self.store, self.clock, days)}
        targets = dict(oee=L.OEE_TARGET, defect=L.DEFECT_LIMIT, downtime_min=L.DOWNTIME_LIMIT_MIN, month_plan=L.MONTH_PLAN)
        return {**self._exec_cache[key], "model": self.model.metrics, "targets": targets}
