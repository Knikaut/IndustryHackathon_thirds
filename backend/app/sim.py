"""Синтетический генератор: дискретная модель линии с износом оборудования.

Один шаг = 5 минут. Каждый пост имеет скрытое «здоровье» h (1 — новый,
0 — критический износ). Износ повышает вибрацию, температуру, ток и время
цикла, а вместе с ними вероятность отказа и брака. Модель прогноза этого h
не видит: она учится только на телеметрии, как училась бы на реальных данных.
"""

import math
import random
from datetime import datetime

from . import layout as L

TICK_S = 300
TICKS_PER_HOUR = 12


class _St:
    __slots__ = ("spec", "h", "down_left", "cause", "acc", "wear", "q_left",
                 "b_vib", "b_temp", "b_cur", "defect_base")

    def __init__(self, spec, rng):
        self.spec = spec
        self.h = rng.uniform(0.55, 1.0)
        self.down_left = 0
        self.cause = None
        self.acc = 0.0
        self.wear = 3.0 / (spec["wear_days"] * 288)
        self.q_left = 0
        self.b_vib = rng.uniform(1.6, 2.6)
        self.b_temp = rng.uniform(48, 62)
        self.b_cur = rng.uniform(14, 24)
        # брак участка из данных организаторов делится между его постами
        in_shop = sum(1 for x in L.STATIONS if x["shop"] == spec["shop"])
        self.defect_base = 0.6 * L.SHOP_DEFECT[spec["shop"]] / in_shop


class Simulator:
    def __init__(self, seed: int = 7):
        self.rng = random.Random(seed)
        self.st = [_St(s, self.rng) for s in L.STATIONS]
        named = {b["after"]: b for b in L.BUFFERS}
        self.cap, self.buf, self.buf_ids = [], [], []
        for s in L.STATIONS[:-1]:
            b = named.get(s["id"])
            self.cap.append(b["cap"] if b else L.INLINE_CAP)
            self.buf.append((b["cap"] // 2) if b else 2)
            self.buf_ids.append(b["id"] if b else None)
        self._was_planned = False
        self.last_models: dict[str, int] = {}   # какие модели сошли с линии за последний шаг

    # --- сценарии для демонстрации -------------------------------------
    def _find(self, sid):
        return next(s for s in self.st if s.spec["id"] == sid)

    def degrade(self, sid, h=0.3):
        self._find(sid).h = h

    def fail(self, sid, minutes=60):
        s = self._find(sid)
        s.down_left = max(1, minutes // 5)
        s.cause = self._pick_cause(s)

    def repair(self, sid):
        s = self._find(sid)
        s.down_left = 0
        s.cause = None
        s.h = 0.97

    # -------------------------------------------------------------------
    def _pick_cause(self, s):
        w = L.CAUSE_WEIGHTS[s.spec["kind"]]
        return self.rng.choices(list(w), weights=list(w.values()))[0]

    @staticmethod
    def mode(ts: datetime) -> str:
        """Режим: две смены по 8 часов с понедельника по пятницу, в субботу плановое ТО."""
        if ts.weekday() == 6:
            return "off"
        if ts.weekday() == 5:
            return "planned" if 8 <= ts.hour < 14 else "off"
        return "work" if ts.hour >= L.SHIFTS[0][0] else "off"

    def step(self, ts: datetime):
        """Один шаг модели. Возвращает (строки по постам, уровни накопителей)."""
        rng = self.rng
        mode = self.mode(ts)
        planned, working = mode == "planned", mode == "work"
        self.last_models = {}
        n = len(self.st)

        if planned and not self._was_planned:
            for s in self.st:
                if s.h < 0.75 and rng.random() < 0.35:
                    s.h = rng.uniform(0.9, 1.0)
        self._was_planned = planned

        # отказы и восстановление
        for s in self.st:
            if s.down_left > 0:
                s.down_left -= 1
                if s.down_left == 0:
                    if s.cause in L.EQUIP_CAUSES:
                        s.h = rng.uniform(0.85, 1.0)
                    s.cause = None
            elif working:
                hazard = 0.00003 + 0.5 * (1 - s.h) ** 7
                if rng.random() < hazard:
                    s.down_left = int(min(20, max(2, rng.lognormvariate(math.log(6), 0.5))))
                    s.cause = self._pick_cause(s)
                elif s.spec["id"] == "L2" and rng.random() < 0.0005:
                    s.down_left = rng.randint(4, 10)
                    s.cause = L.SUPPLY_CAUSE
                elif s.spec["kind"] == "robot" and rng.random() < 0.0004:
                    s.down_left = 6
                    s.cause = L.SERVICE_CAUSE
            if s.q_left > 0:
                s.q_left -= 1
            elif s.spec["kind"] in ("spray", "bath", "robot") and rng.random() < 0.0004:
                s.q_left = rng.randint(24, 48)

        # поток: от конца линии к началу, чтобы место в накопителях освобождалось
        rows = [None] * n
        day_wave = 2.0 * math.sin(2 * math.pi * (ts.hour + ts.minute / 60) / 24)
        for i in range(n - 1, -1, -1):
            s = self.st[i]
            units = defects = 0
            vib = temp = cur = cyc = None
            if not working:
                state = mode
            elif s.down_left > 0:
                state = "down"
            else:
                wear = 1 - s.h
                cyc = s.spec["cycle_s"] * (1 + 0.15 * wear) * rng.uniform(0.985, 1.015)
                capacity = TICK_S / cyc
                if rng.random() < 0.03 + 0.15 * wear:
                    capacity *= 0.6
                s.acc += capacity
                want = int(s.acc)
                s.acc -= want
                avail = self.buf[i - 1] if i > 0 else want
                space = self.cap[i] - self.buf[i] if i < n - 1 else want
                units = max(0, min(want, avail, space))
                if units == 0 and want > 0:
                    state = "starved" if avail <= space else "blocked"
                else:
                    state = "run"
                if i > 0:
                    self.buf[i - 1] -= units
                if i < n - 1:
                    self.buf[i] += units
                elif units:
                    names, weights = zip(*L.MODELS)
                    for m in rng.choices(names, weights=weights, k=units):
                        self.last_models[m] = self.last_models.get(m, 0) + 1
                p_def = s.defect_base * (5 if s.q_left > 0 else 1) + 0.01 * wear ** 2
                for _ in range(units):
                    if rng.random() < p_def:
                        defects += 1
                idle = 0.35 if units == 0 else 1.0
                vib = (s.b_vib + 4.5 * wear ** 2) * idle + rng.gauss(0, 0.15)
                temp = s.b_temp + 22 * wear * idle + day_wave + rng.gauss(0, 1.0)
                cur = s.b_cur * (1 + 0.12 * wear) * idle + rng.gauss(0, 0.3)
                if units > 0:
                    s.h = max(0.05, s.h - s.wear * rng.uniform(0.5, 1.5))
            rows[i] = (s.spec["id"], state, units, defects, vib, temp, cur, cyc,
                       s.cause if state == "down" else None)
        return rows, list(self.buf)
