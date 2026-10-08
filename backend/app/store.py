"""Хранилище наблюдений по тактам (5 минут) и производные агрегаты.

Всё, что выше этого слоя (KPI, прогноз, API), читает данные только отсюда.
Источник может быть любым: синтетический генератор или файлы организаторов —
достаточно вызывать ingest() со строками того же вида.
"""

from bisect import bisect_right
from datetime import datetime, timedelta

from . import layout as L

NAN = float("nan")
SIDS = [s["id"] for s in L.STATIONS]
IDX = {sid: i for i, sid in enumerate(SIDS)}
# индексы полей почасового агрегата
TICKS, RUN, DOWN, STARVED, BLOCKED, PLANNED, UNITS, DEFECTS = range(8)
# нерабочее время, как и плановое ТО, не входит в плановый фонд
_STATE_COL = {"run": RUN, "down": DOWN, "starved": STARVED, "blocked": BLOCKED, "planned": PLANNED, "off": PLANNED}


class Series:
    __slots__ = ("state", "units", "defects", "vib", "temp", "cur", "cyc", "risk",
                 "fail_idx", "repair_idx")

    def __init__(self):
        self.state, self.units, self.defects = [], [], []
        self.vib, self.temp, self.cur, self.cyc = [], [], [], []
        self.risk = []
        self.fail_idx = []    # такты начала отказов оборудования
        self.repair_idx = []  # такты окончания простоев


class Store:
    def __init__(self):
        self.ts: list[datetime] = []
        self.series = {sid: Series() for sid in SIDS}
        self.hourly: dict[datetime, list[list[int]]] = {}
        self.events: list[dict] = []          # простои
        self._open: dict[str, dict] = {}
        self.buf: list[list[int]] = []        # уровни накопителей по тактам
        self.work: list[int] = []             # номера рабочих тактов (не ночь, не выходной, не плановое ТО)
        self.models: dict = {}                # дата -> {модель: выпуск}

    def __len__(self):
        return len(self.ts)

    def ingest(self, ts: datetime, rows, buf):
        t = len(self.ts)
        self.ts.append(ts)
        self.buf.append(buf)
        if rows[0][1] not in ("off", "planned"):
            self.work.append(t)
        hour = ts.replace(minute=0, second=0, microsecond=0)
        agg = self.hourly.get(hour)
        if agg is None:
            agg = self.hourly[hour] = [[0] * 8 for _ in SIDS]
        for i, (sid, state, units, defects, vib, temp, cur, cyc, cause) in enumerate(rows):
            s = self.series[sid]
            s.state.append(state)
            s.units.append(units)
            s.defects.append(defects)
            working = units > 0
            s.vib.append(vib if working else NAN)
            s.temp.append(temp if working else NAN)
            s.cur.append(cur if working else NAN)
            s.cyc.append(cyc if working else NAN)
            a = agg[i]
            a[TICKS] += 1
            a[_STATE_COL[state]] += 1
            a[UNITS] += units
            a[DEFECTS] += defects

            ev = self._open.get(sid)
            if state == "down":
                if ev is None:
                    ev = dict(id=len(self.events) + 1, station=sid, shop=L.STATION_BY_ID[sid]["shop"],
                              cause=cause, start=ts, end=None, minutes=0)
                    self.events.append(ev)
                    self._open[sid] = ev
                    if cause in L.EQUIP_CAUSES:
                        s.fail_idx.append(t)
                ev["minutes"] += 5
            elif ev is not None:
                ev["end"] = ts
                s.repair_idx.append(t)
                del self._open[sid]

    def add_models(self, ts: datetime, counts: dict):
        if counts:
            day = self.models.setdefault(ts.date(), {})
            for m, k in counts.items():
                day[m] = day.get(m, 0) + k

    def downtime_today(self, sid: str, ts: datetime) -> int:
        """Минуты простоя поста с начала календарных суток."""
        day, total = ts.date(), 0
        for ev in reversed(self.events):
            if ev["start"].date() < day:
                break
            if ev["station"] == sid:
                total += ev["minutes"]
        return total

    # --- вспомогательные выборки ---------------------------------------
    def hours_since_repair(self, sid: str, t: int) -> float:
        r = self.series[sid].repair_idx
        k = bisect_right(r, t)
        return min(500.0, (t - r[k - 1]) / 12) if k else 500.0

    def fails_72h(self, sid: str, t: int) -> int:
        f = self.series[sid].fail_idx
        return bisect_right(f, t) - bisect_right(f, t - 864)

    def is_work(self, t: int) -> bool:
        k = bisect_right(self.work, t)
        return k > 0 and self.work[k - 1] == t

    def work_bins(self, size: int, count: int) -> list[list[int]]:
        """Последние count корзин по size рабочих тактов для графиков.

        Корзины нарезаны по сквозному счёту рабочих тактов, а не от текущего
        момента, поэтому заполненная корзина больше не меняется: на графике
        дописывается только правая точка. Последняя корзина может быть неполной.
        """
        w = self.work
        last = (len(w) - 1) // size
        return [w[b * size:(b + 1) * size] for b in range(max(0, last - count + 1), last + 1)]

    def open_event(self, sid: str):
        return self._open.get(sid)

    def hours_between(self, start: datetime, end: datetime):
        h = start.replace(minute=0, second=0, microsecond=0)
        while h <= end:
            if h in self.hourly:
                yield h
            h += timedelta(hours=1)
