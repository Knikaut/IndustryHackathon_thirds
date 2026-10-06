import { useState } from "react";
import {
  dec, dur, hhmm, Incident, int, Layout, pct, post, Snapshot, STATE_LABEL, StationDetail, usePoll,
} from "./api";
import { LineChart, PlanFact } from "./charts";
import { Mimic } from "./Mimic";

function Instruments({ snap }: { snap: Snapshot }) {
  const k = snap.kpi;
  const ratio = k.plan ? k.fact / k.plan : 1;
  const openDown = snap.stations.filter((s) => s.state === "down").length;
  const t = snap.targets, defect = 1 - k.quality;
  return (
    <section className="instruments" aria-label="Показатели смены">
      <div className="inst wide">
        <h2>Выпуск смены</h2>
        <p className="big num">{int(k.fact)}<small> из {int(k.plan)} к этому часу</small></p>
        <div className="gauge" role="img" aria-label={`Факт ${k.fact} из плана смены ${snap.shift.plan_total}`}>
          <i style={{ transform: `scaleX(${Math.min(1, k.fact / snap.shift.plan_total)})` }} className={ratio < 0.9 ? "low" : ""} />
          <b style={{ left: `${Math.min(100, (k.plan / snap.shift.plan_total) * 100)}%` }} />
        </div>
        <p className="sub">{ratio >= 1 ? "Идём с опережением" : ratio >= 0.9 ? "В допуске" : "Отставание"}: <span className="num">{pct(ratio, 0)} %</span> плана · план смены <span className="num">{snap.shift.plan_total}</span></p>
      </div>
      <div className="inst">
        <h2>OEE линии</h2>
        <p className={`big num ${k.oee < t.oee ? "warn" : ""}`}>{pct(k.oee)}<small> % при цели {pct(t.oee, 0)} %</small></p>
        <p className="sub split">
          <span>готовность <b className="num">{pct(k.availability)}</b></span>
          <span>темп <b className="num">{pct(k.performance)}</b></span>
          <span>качество <b className="num">{pct(k.quality)}</b></span>
        </p>
      </div>
      <div className="inst">
        <h2>Загрузка</h2>
        <p className="big num">{pct(k.load)}<small> %</small></p>
        <p className="sub">доля времени, когда посты заняты работой</p>
      </div>
      <div className="inst">
        <h2>Простои</h2>
        <p className={`big num ${openDown ? "bad" : ""}`}>{int(k.downtime_min)}<small> мин за смену</small></p>
        <p className="sub">{openDown ? `сейчас стоит постов: ${openDown}` : "сейчас все посты в работе"}</p>
      </div>
      <div className="inst">
        <h2>Качество</h2>
        <p className="big num">{pct(k.quality)}<small> % с первого раза</small></p>
        <p className="sub">дефектов за смену: <span className="num">{int(k.defects)}</span> · {defect > t.defect ? "брак выше нормы" : "брак в норме"} {pct(t.defect, 0)} %</p>
      </div>
    </section>
  );
}

const TYPE_LABEL: Record<Incident["type"], string> = {
  downtime: "Простой", forecast: "Прогноз ИИ", quality: "Качество", plan: "План", buffer: "Накопитель", bottleneck: "Узкое место", limit: "Норматив",
};
const FILTERS: [string, string][] = [["all", "Все"], ["downtime", "Простои"], ["forecast", "Прогноз"], ["quality", "Качество"], ["flow", "Поток"]];

export function Feed({ snap, onSelect }: { snap: Snapshot; onSelect: (id: string) => void }) {
  const [filter, setFilter] = useState("all");
  const items = snap.incidents.filter((i) =>
    filter === "all" ? true : filter === "flow" ? ["plan", "buffer", "bottleneck"].includes(i.type) : filter === "downtime" ? ["downtime", "limit"].includes(i.type) : i.type === filter);
  const open = items.filter((i) => i.open);
  const closed = items.filter((i) => !i.open);
  const row = (i: Incident) => {
    const clickable = snap.stations.some((s) => s.id === i.station);
    return (
      <li key={i.id} className={`inc ${i.type} ${i.open ? "open" : ""} ${i.severity}`}>
        <button disabled={!clickable} onClick={() => onSelect(i.station)}>
          <span className="inc-head">
            <span className="inc-type">{TYPE_LABEL[i.type]}</span>
            <time className="num">{hhmm(i.start)}{i.end ? `–${hhmm(i.end)}` : ""}</time>
          </span>
          <strong>{i.title}</strong>
          <span className="inc-detail">{i.detail}</span>
          {i.open && i.action && <span className="inc-action">{i.action}</span>}
          {i.outcome === "confirmed" && <span className="inc-outcome">Прогноз подтвердился: пост отказал</span>}
        </button>
      </li>
    );
  };
  return (
    <aside className="side" aria-label="Инциденты и отклонения">
      <div className="side-head">
        <h2>Инциденты и отклонения</h2>
        <div className="chips" role="group" aria-label="Фильтр">
          {FILTERS.map(([id, label]) => (
            <button key={id} className={filter === id ? "on" : ""} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="side-body">
        {open.length === 0 && <p className="calm">Открытых инцидентов нет. Линия идёт штатно.</p>}
        {open.length > 0 && <><h3>Требуют внимания · {open.length}</h3><ul>{open.map(row)}</ul></>}
        {closed.length > 0 && <><h3>Закрытые за сутки</h3><ul>{closed.map(row)}</ul></>}
      </div>
    </aside>
  );
}

export function Passport({ id, snap, onClose }: { id: string; snap: Snapshot; onClose: () => void }) {
  const { data } = usePoll<StationDetail>(`/api/stations/${id}`, 3000);
  const live = snap.stations.find((s) => s.id === id)!;
  if (!data || data.id !== id) return <aside className="side"><p className="calm">Загружаю паспорт поста…</p></aside>;
  const xs = data.series.length ? [hhmm(data.series[0].t), hhmm(data.series[Math.floor(data.series.length / 2)].t), "сейчас"] : undefined;
  const col = (k: "vib" | "temp" | "cur" | "risk") => data.series.map((p) => p[k]);
  return (
    <aside className="side" aria-label={`Паспорт поста ${data.name}`}>
      <div className="side-head">
        <div>
          <h2>{data.id} · {data.name}</h2>
          <p className="muted">{data.shop_name} · {data.asset}</p>
        </div>
        <button className="ghost" onClick={onClose}>К инцидентам</button>
      </div>
      <div className="side-body">
        {data.op && <p className="op">{data.op}</p>}
        <p className={`state-line ${live.state}`}>
          <i className="dot" />{STATE_LABEL[live.state]}
          {live.state === "down" && <> · {live.cause} · {dur(live.down_min)}</>}
        </p>

        <div className={`risk-box ${live.risk_level}`}>
          <p className="risk-num num">{pct(live.risk, 0)}<small> %</small></p>
          <div>
            <strong>Риск отказа в ближайшие {snap.horizon_h} ч</strong>
            {data.factors.length ? (
              <ul className="factors">
                {data.factors.map((f) => <li key={f.key}>{f.label}: <b className="num">{f.value}</b></li>)}
              </ul>
            ) : <p className="muted">Сигналы в норме.</p>}
            <p className="advice">{data.action}</p>
          </div>
        </div>
        <LineChart height={96} min={0} max={1} series={[{ values: col("risk"), color: "var(--ai)" }]} area
          refLine={{ value: snap.threshold, label: "порог тревоги", color: "var(--ai)" }}
          xLabels={xs} fmt={(v) => `${Math.round(v * 100)}`} />

        <dl className="facts">
          <div><dt>За смену</dt><dd className="num">{int(live.units)} шт</dd></div>
          <div><dt>OEE поста</dt><dd className="num">{pct(live.oee)} %</dd></div>
          <div><dt>Брак</dt><dd className="num">{int(live.defects)} шт</dd></div>
          <div><dt>Цикл</dt><dd className="num">{dec(live.cyc)} с<small> / {data.cycle_s}</small></dd></div>
          <div><dt>Простой за сутки</dt><dd className={`num ${live.downtime_day_min > snap.targets.downtime_min ? "warn" : ""}`}>{dur(live.downtime_day_min)}<small> / {snap.targets.downtime_min} мин</small></dd></div>
          <div><dt>После ремонта</dt><dd className="num">{data.hours_since_repair >= 500 ? "более 500 ч" : `${int(data.hours_since_repair)} ч`}</dd></div>
        </dl>

        <h3>Вибрация, мм/с</h3>
        <LineChart height={96} series={[{ values: col("vib"), color: "var(--ink)" }]} xLabels={xs}
          refLine={{ value: data.base.vib, label: "норма" }} fmt={(v) => dec(v)} />
        <h3>Температура узла, °C</h3>
        <LineChart height={96} series={[{ values: col("temp"), color: "var(--ink)" }]} xLabels={xs}
          refLine={{ value: data.base.temp, label: "норма" }} fmt={(v) => int(v)} />
        <h3>Ток привода, А</h3>
        <LineChart height={96} series={[{ values: col("cur"), color: "var(--ink)" }]} xLabels={xs}
          refLine={{ value: data.base.cur, label: "норма" }} fmt={(v) => dec(v)} />

        <h3>Последние простои</h3>
        {data.events.length ? (
          <table className="mini">
            <tbody>
              {data.events.map((e) => (
                <tr key={e.start}><td className="num">{e.start.slice(8, 10)}.{e.start.slice(5, 7)} {hhmm(e.start)}</td><td>{e.cause}</td><td className="num r">{dur(e.minutes)}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">За период наблюдения простоев не было.</p>}

        <div className="scenario">
          <h3>Сценарии для демонстрации</h3>
          <p className="muted">Меняют состояние модели завода, чтобы показать реакцию двойника.</p>
          <div className="btns">
            <button onClick={() => post(`/api/demo/degrade/${id}`)}>Ускорить износ</button>
            <button onClick={() => post(`/api/demo/fail/${id}?minutes=90`)}>Отказ на 90 мин</button>
            <button onClick={() => post(`/api/demo/repair/${id}`)}>Отремонтировать</button>
          </div>
        </div>
      </div>
    </aside>
  );
}

export function Board({
  layout, snap, selected, onSelect,
}: { layout: Layout; snap: Snapshot; selected: string | null; onSelect: (id: string | null) => void }) {
  return (
    <main className="board">
      <Instruments snap={snap} />
      <div className="board-main">
        <section className="panel">
          <Mimic layout={layout} snap={snap} selected={selected} onSelect={onSelect} />
          <div className="under">
            <div>
              <h2>Выпуск по часам, шт</h2>
              <PlanFact height={110} items={snap.hourly.map((h) => ({ label: hhmm(h.hour), fact: h.fact, plan: h.plan }))} />
              <p className="key"><i className="k-fact" />факт <i className="k-plan" />план <i className="k-short" />ниже плана</p>
            </div>
            <div className="bn-note">
              <h2>Узкое место</h2>
              {snap.bottleneck ? (
                <p><button className="link" onClick={() => onSelect(snap.bottleneck!.station)}>{snap.bottleneck.station} · {snap.bottleneck.name}</button>: {snap.bottleneck.reason}. Оценка за последние {dur(snap.bottleneck.window_min)}.</p>
              ) : <p className="muted">Поток сбалансирован: ни один пост не сдерживает соседей.</p>}
            </div>
          </div>
        </section>
        {selected
          ? <Passport key={selected} id={selected} snap={snap} onClose={() => onSelect(null)} />
          : <Feed snap={snap} onSelect={onSelect} />}
      </div>
    </main>
  );
}
