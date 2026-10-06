"""Прогноз простоев и узких мест.

Модель: градиентный бустинг по телеметрии поста. Целевое событие — отказ
оборудования в ближайшие HORIZON_H часов. Признаки считаются относительно
«здоровой» нормы самого поста, поэтому модель переносится между постами.
"""

import numpy as np
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.metrics import average_precision_score, roc_auc_score

from . import layout as L
from .store import SIDS, Store

HORIZON_H = 8
HORIZON = HORIZON_H * 12
FEATS = ["vib_rel", "temp_rel", "cur_rel", "cyc_rel", "vib_d6", "temp_d6", "vib_d24",
         "hrs_rep", "fails72"]
THRESHOLD = 0.2  # с какого риска поднимаем предупреждение


def _nm(x):
    m = ~np.isnan(x)
    return float(x[m].mean()) if m.any() else np.nan


def features(vib, temp, cur, cyc, t, base, hrs_rep, fails72):
    """Признаки поста на такт t (включительно). Массивы — numpy, NaN = не работал."""
    a = max(0, t - 11)
    v1, t1 = _nm(vib[a:t + 1]), _nm(temp[a:t + 1])
    c1, y1 = _nm(cur[a:t + 1]), _nm(cyc[a:t + 1])
    b = max(0, t - 83)
    v6, t6 = _nm(vib[b:b + 12]), _nm(temp[b:b + 12])
    v24 = _nm(vib[max(0, t - 287):t + 1])
    return [v1 - base["vib"], t1 - base["temp"], c1 / base["cur"] - 1, y1 / base["cyc"] - 1,
            v1 - v6, t1 - t6, v1 - v24, hrs_rep, fails72]


class Forecaster:
    def __init__(self, store: Store):
        self.store = store
        self.base = {}
        self.model = None
        self.metrics = {}

    def _arrays(self, sid, lo=0, hi=None):
        s = self.store.series[sid]
        return tuple(np.asarray(x[lo:hi], dtype=float) for x in (s.vib, s.temp, s.cur, s.cyc))

    def train(self):
        store, n = self.store, len(self.store)
        X, y, when, who = [], [], [], []
        for sid in SIDS:
            vib, temp, cur, cyc = self._arrays(sid)
            self.base[sid] = dict(vib=float(np.nanpercentile(vib, 10)), temp=float(np.nanpercentile(temp, 10)),
                                  cur=float(np.nanpercentile(cur, 10)), cyc=float(np.nanpercentile(cyc, 10)))
            fails = np.zeros(n + HORIZON + 1)
            fails[store.series[sid].fail_idx] = 1
            ahead = np.cumsum(fails)
            states = store.series[sid].state
            for t in range(300, n - HORIZON, 12):
                if states[t] in ("down", "planned"):
                    continue
                X.append(features(vib, temp, cur, cyc, t, self.base[sid],
                                  store.hours_since_repair(sid, t), store.fails_72h(sid, t)))
                y.append(int(ahead[t + HORIZON] - ahead[t] > 0))
                when.append(t)
                who.append(sid)
        X, y, when, who = np.array(X), np.array(y), np.array(when), np.array(who)

        def fit(Xa, ya):
            m = HistGradientBoostingClassifier(max_depth=4, max_iter=160, learning_rate=0.07,
                                               l2_regularization=1.0, random_state=0)
            return m.fit(Xa, ya)

        # честная проверка: учим на первых 75% времени, проверяем на последних 25%
        cut = np.quantile(when, 0.75)
        tr, te = when <= cut - HORIZON, when > cut
        probe = fit(X[tr], y[tr])
        p = probe.predict_proba(X[te])[:, 1]
        alarm = p >= THRESHOLD
        tp = int((alarm & (y[te] == 1)).sum())
        self.metrics = dict(
            roc_auc=float(roc_auc_score(y[te], p)), pr_auc=float(average_precision_score(y[te], p)),
            precision=tp / max(1, int(alarm.sum())), recall=tp / max(1, int(y[te].sum())),
            base_rate=float(y[te].mean()), train_rows=int(tr.sum()), test_rows=int(te.sum()),
            failures_total=sum(len(store.series[s].fail_idx) for s in SIDS),
            horizon_h=HORIZON_H, threshold=THRESHOLD, features=FEATS,
            algorithm="HistGradientBoostingClassifier (scikit-learn)",
        )
        # по событиям: сколько отказов было предсказано заранее и за сколько часов
        caught, leads, total = 0, [], 0
        for sid in SIDS:
            m = who[te] == sid
            tw, pw = when[te][m], p[m]
            for f in store.series[sid].fail_idx:
                if f <= cut + HORIZON:
                    continue
                total += 1
                hit = tw[(tw >= f - HORIZON) & (tw < f) & (pw >= THRESHOLD)]
                if len(hit):
                    caught += 1
                    leads.append((f - hit.min()) / 12)
        self.metrics.update(test_failures=total, caught_failures=caught,
                            event_recall=caught / max(1, total),
                            lead_h=float(np.median(leads)) if leads else None)
        self.model = fit(X, y)

    def feats_now(self, sid, t=None):
        store = self.store
        t = len(store) - 1 if t is None else t
        lo = max(0, t - 299)
        vib, temp, cur, cyc = self._arrays(sid, lo, t + 1)
        return features(vib, temp, cur, cyc, t - lo, self.base[sid],
                        store.hours_since_repair(sid, t), store.fails_72h(sid, t))

    def predict(self, t=None):
        """Риск отказа по всем постам на такт t. Возвращает ({sid: p}, {sid: признаки})."""
        F = {sid: self.feats_now(sid, t) for sid in SIDS}
        p = self.model.predict_proba(np.array([F[s] for s in SIDS]))[:, 1]
        return dict(zip(SIDS, map(float, p))), F


def explain(f: list, kind: str):
    """Какие сигналы стоят за риском и что с этим делать."""
    d = dict(zip(FEATS, f))
    out = []

    def add(key, label, value, weight):
        if weight > 1 and not np.isnan(weight):
            out.append(dict(key=key, label=label, value=value, weight=round(float(weight), 2)))

    add("vib", "Вибрация", f"+{d['vib_rel']:.1f} мм/с к норме", d["vib_rel"] / 0.6)
    add("temp", "Температура узла", f"+{d['temp_rel']:.0f} °C к норме", d["temp_rel"] / 6)
    add("cur", "Ток привода", f"+{d['cur_rel'] * 100:.0f} % к норме", d["cur_rel"] / 0.035)
    add("cyc", "Время цикла", f"+{d['cyc_rel'] * 100:.0f} % к норме", d["cyc_rel"] / 0.04)
    add("trend", "Рост вибрации за 6 ч", f"+{d['vib_d6']:.2f} мм/с", d["vib_d6"] / 0.25)
    add("fails", "Отказы за 72 ч", f"{int(d['fails72'])}", d["fails72"] * 1.5)
    out.sort(key=lambda x: -x["weight"])
    top = out[0]["key"] if out else None
    action = {
        "vib": "Проверить подшипниковые узлы и крепления, провести ТО в ближайшее окно",
        "trend": "Износ ускоряется: осмотреть узел до конца смены",
        "temp": "Проверить охлаждение и смазку узла",
        "cur": "Проверить привод и механическую нагрузку",
        "cyc": "Проверить оснастку и программу цикла",
        "fails": "Повторные отказы: разобрать причину, не ограничиваться сбросом",
    }.get(top, "Плановый осмотр по регламенту")
    return out[:3], action


def bottleneck(store: Store, window: int = 24):
    """Узкое место: пост, перед которым копится, а после которого голодают."""
    n = len(store)
    lo = max(0, n - window)
    share = {}
    for sid in SIDS:
        st = store.series[sid].state[lo:n]
        k = max(1, len(st))
        share[sid] = (st.count("blocked") / k, st.count("starved") / k, st.count("down") / k)
    best, best_score = None, 0.0
    for i, sid in enumerate(SIDS):
        blocked, starved, down = share[sid]
        up = share[SIDS[i - 1]][0] if i > 0 else 0.0
        dn = share[SIDS[i + 1]][1] if i < len(SIDS) - 1 else 0.0
        score = up - blocked + dn - starved
        if score > best_score:
            best, best_score = sid, score
    if best is None or best_score < 0.35:
        return None
    spec = L.STATION_BY_ID[best]
    down = 1.0 if store.series[best].state[-1] == "down" else share[best][2]
    reason = ("пост простаивает, поток перед ним остановлен" if down > 0.3
              else "пост работает медленнее соседних, перед ним копится задел")
    return dict(station=best, name=spec["name"], shop=spec["shop"], score=round(best_score, 2),
                reason=reason, window_min=window * 5)


def buffer_outlook(store: Store, sim_caps: dict):
    """Прогноз заполнения накопителей по тренду последнего часа."""
    n = len(store)
    out = []
    for b in L.BUFFERS:
        i = SIDS.index(b["after"])
        level = store.buf[n - 1][i]
        past = store.buf[max(0, n - 13)][i]
        slope = (level - past) / max(1, min(12, n - 1))  # шт за такт
        eta, direction = None, "stable"
        if slope > 0.05:
            direction, eta = "filling", (b["cap"] - level) / slope * 5
        elif slope < -0.05:
            direction, eta = "draining", level / -slope * 5
        hist = [store.buf[k][i] for k in range(max(0, n - 144), n, 3)]
        out.append(dict(id=b["id"], name=b["name"], after=b["after"], cap=b["cap"], level=level,
                        direction=direction, eta_min=round(eta) if eta is not None else None,
                        per_hour=round(slope * 12, 1), history=hist))
    return out
