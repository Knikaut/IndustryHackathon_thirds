import { useState } from "react";
import {
  dec, dur, hhmm, Incident, int, Layout, pct, post, Snapshot, STATE_LABEL, StationDetail, usePoll,
} from "./api";
import { LineChart, PlanFact } from "./charts";
import { Mimic } from "./Mimic";

function Instruments({ snap }: { snap: Snapshot }) {
  const k = snap.kpi, t = snap.targets;
  // линия не работает: все посты на плановом ТО или вне смены — оценивать выполнение плана нечем
  const stopped = snap.stations.every((s) => s.state === "planned" || s.state === "off");
  const service = stopped && snap.stations.some((s) => s.state === "planned");
  // первые полчаса смены доли считаются по одной-двум машинам и дают невозможные проценты
  const early = !stopped && k.sched_hours < 0.5;
  const quiet = stopped || early;
  const why = stopped ? (service ? "плановое ТО" : "вне смены") : "смена началась";
  const ratio = k.plan ? k.fact / k.plan : null;
  const total = snap.shift.plan_total;
  const openDown = snap.stations.filter((s) => s.state === "down").length;
  const badShops = new Set(snap.incidents.filter((i) => i.open && i.type === "quality").map((i) => i.shop ?? i.station)).size;
  const share = (x: number | null) => (quiet || x == null ? "—" : pct(x, 0));
  const tenth = (x: number | null) => (quiet || x == null ? "—" : pct(x));
  const low = !quiet && k.oee != null && Math.round(k.oee * 100) < Math.round(t.oee * 100);
  return (
    <section className="instruments" aria-label="Показатели смены">
      <div className="inst wide">
        <h2>Выпуск смены</h2>
        <div className="big-row">
          <p className="big num">{int(k.fact)}<small> из {int(k.plan)} к этому часу</small></p>
          <div className="gauge" role="img" aria-label={`Факт ${k.fact} из плана смены ${total}`}>
            <i style={{ transform: `scaleX(${total ? Math.min(1, k.fact / total) : 0})` }} className={!quiet && ratio != null && ratio < 0.9 ? "low" : ""} />
            <b style={{ left: `${total ? Math.min(100, (k.plan / total) * 100) : 0}%` }} />
          </div>
        </div>
        {stopped ? (
          <p className="sub">Линия остановлена: {why}</p>
        ) : (
          <p className="sub">
            <span className="num">{early || ratio == null ? "—" : pct(ratio, 0)} %</span> плана · {early || ratio == null ? why : ratio > 1 ? "с опережением" : ratio >= 0.9 ? "в допуске" : "отставание"} · план смены <span className="num">{total}</span>
          </p>
        )}
      </div>
      <div className="inst">
        <h2>OEE линии</h2>
        <p className={`big num ${low ? "warn" : ""}`}>{share(k.oee)}<small>{quiet ? ` ${why}` : ` % при цели ${pct(t.oee, 0)} %`}</small></p>
        <p className="sub" title="Готовность × темп × качество">
          <span className="w-full">готовность</span><span className="w-short">гот.</span> <b className="num">{tenth(k.availability)}</b>
          {" · "}темп <b className="num">{tenth(k.performance)}</b>
          {" · "}<span className="w-full">качество</span><span className="w-short">кач.</span> <b className="num">{tenth(k.quality)}</b>
        </p>
      </div>
      <div className="inst">
        <h2>Загрузка</h2>
        <p className="big num">{share(k.load)}<small>{quiet ? "" : " %"}</small></p>
        <p className="sub" title="Доля времени, когда посты заняты работой">доля времени в работе</p>
      </div>
      <div className="inst">
        <h2>Простои</h2>
        <p className={`big num ${openDown ? "bad" : ""}`}>{int(k.downtime_min)}<small> мин за смену</small></p>
        <p className="sub">{openDown ? <>сейчас стоит постов: <b className="num">{openDown}</b></> : stopped ? why : "сейчас простоев нет"}</p>
      </div>
      <div className="inst">
        <h2>Качество</h2>
        <p className="big num">{share(k.quality)}<small>{quiet ? "" : " %"} с первого раза</small></p>
        <p className="sub" title={`Участков с открытым инцидентом качества: ${badShops}. Норма брака участка за смену: не более ${pct(t.defect, 0)} %`}>
          дефектов <b className="num">{int(k.defects)}</b> · {badShops
            ? <><span className="w-full">участков </span>выше нормы: <b className="num">{badShops}</b><span className="w-short"> уч.</span></>
            : "участки в норме"}
        </p>
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
    <aside className="side feed" aria-label="Инциденты и отклонения">
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

type Scenario = "degrade" | "fail" | "repair";
const SCENARIOS: [Scenario, string, string, string][] = [
  ["degrade", "Ускорить износ", "", "Износ ускорен: предупреждение через 10–25 с"],
  ["fail", "Отказ на 90 мин", "?minutes=90", "Отказ задан: пост встанет через такт"],
  ["repair", "Отремонтировать", "", "Ремонт выполнен: пост запустится через такт"],
];
type Tab = "main" | "sensors" | "stops";
const TABS: [Tab, string][] = [["main", "Обзор"], ["sensors", "Телеметрия"], ["stops", "Простои"]];
// ряд паспорта всегда покрывает последние 24 часа работы линии (ночь и выходные в него не входят),
// поэтому подписи времени постоянные
const DAY = ["24 ч работы назад", "12 ч", "сейчас"];
const STOPS = 6;

export function Passport({
  id, layout, snap, onClose,
}: { id: string; layout: Layout; snap: Snapshot; onClose: () => void }) {
  // паспорт обновляется вместе со щитом: запрос уходит при смене такта, а не по своему таймеру
  const { data } = usePoll<StationDetail>(`/api/stations/${id}`, 0, { tick: snap.clock });
  const [tab, setTab] = useState<Tab>("main");
  const [note, setNote] = useState<{ id: string; text: string } | null>(null);
  const spec = layout.stations.find((s) => s.id === id);
  const live = snap.stations.find((s) => s.id === id);
  if (!spec || !live) return null;
  // пока ответ по новому посту в пути, шапка и живые числа уже новые, а графики и таблица прежние, приглушённые
  const own = data && data.id === id ? data : null;
  const fresh = !!own;
  const shop = layout.shops.find((s) => s.id === spec.shop);
  const listed = snap.forecast.find((f) => f.station === id);
  const factors = own?.factors ?? listed?.factors ?? data?.factors ?? [];
  // при низком риске совет не показываем: «разобрать причину» рядом с риском 1 % читается как тревога
  const action = live.risk_level === "low" ? "Действий не требуется" : own?.action ?? listed?.action ?? data?.action ?? "";
  const known = fresh || !!listed;
  const col = (k: "vib" | "temp" | "cur" | "risk") => (data ? data.series.map((p) => p[k]) : []);
  const base = data?.base;
  const span = (lo: number, hi: number): [number, number] => [lo, hi];
  const events = data ? data.events.slice(0, STOPS) : [];

  const run = (kind: Scenario, query: string, done: string) => {
    setNote({ id, text: "Отправляю команду…" });
    post(`/api/demo/${kind}/${id}${query}`)
      .then((r) => setNote({ id, text: r.ok ? done : "Сервер не принял команду, попробуйте ещё раз" }))
      .catch(() => setNote({ id, text: "Нет связи с сервером, команда не отправлена" }));
  };
  const hint = snap.paused
    ? "Двойник на паузе: нажмите «Продолжить» в шапке"
    : note?.id === id ? note.text : "Сценарии показа меняют состояние модели завода";

  const open = snap.incidents.filter((i) => i.open);
  const latest = open.reduce<Incident | null>((a, i) => (!a || i.start > a.start || (i.start === a.start && i.station === id && a.station !== id) ? i : a), null);

  return (
    <aside className="side passport" aria-label={`Паспорт поста ${spec.name}`}>
      <div className="side-head">
        <h2 title={`${spec.id} · ${spec.name} · ${shop?.full ?? ""} · ${spec.asset}`}>{spec.id} · {spec.name}</h2>
        <button className="ghost" onClick={onClose}>Закрыть</button>
      </div>
      <div className="pass-top">
        <p className={`state-line ${live.state}`}>
          <i className="dot" />
          <span>{STATE_LABEL[live.state]}{live.state === "down" && <> · {live.cause} · {dur(live.down_min)}</>}</span>
          <span className="asset" title={spec.asset}>{spec.asset}</span>
        </p>

        <div className="scenario" role="group" aria-label="Сценарии для демонстрации">
          <div className="btns">
            {SCENARIOS.map(([kind, label, query, done]) => (
              <button key={kind} disabled={snap.paused} onClick={() => run(kind, query, done)}>{label}</button>
            ))}
          </div>
          <p className="scenario-note" role="status" title={hint}>{hint}</p>
        </div>

        <div className="tabs" role="tablist" aria-label="Разделы паспорта">
          {TABS.map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="side-body">
        {tab === "main" && (
          <div className="pane" role="tabpanel" aria-label="Обзор">
            <div className={`risk-box ${live.risk_level}`}>
              <p className="risk-num num">{pct(live.risk, 0)}<small> %</small></p>
              <div className={known ? "" : "stale"}>
                <strong>Риск отказа за {snap.horizon_h} ч работы линии</strong>
                {/* место под три сигнала и две строки совета занято всегда: блоки ниже не сдвигаются */}
                <ul className="factors">
                  {factors.slice(0, 3).map((f) => <li key={f.key}>{f.label}: <b className="num">{f.value}</b></li>)}
                  {!factors.length && <li>{known ? "Сигналы в норме." : "…"}</li>}
                </ul>
              </div>
              <p className={known ? "advice" : "advice stale"} title={action}>{action}</p>
            </div>
            <div className={fresh ? "dep" : "dep stale"}>
              <LineChart key={data?.id} fit min={0} max={1} series={[{ values: col("risk"), color: "var(--ai)" }]} area
                refLine={{ value: snap.threshold, label: "порог тревоги", color: "var(--ai)" }}
                xLabels={DAY} fmt={(v) => `${Math.round(v * 100)}`} />
            </div>
            <dl className="facts">
              <div><dt>За смену</dt><dd className="num">{int(live.units)} шт</dd></div>
              <div><dt>OEE поста</dt><dd className="num">{pct(live.oee, 0)} %</dd></div>
              <div><dt>Брак</dt><dd className="num">{int(live.defects)} шт</dd></div>
              <div><dt>Цикл, с</dt><dd className="num">{dec(live.cyc)}<small> / {spec.cycle_s}</small></dd></div>
              <div><dt>Простой за сутки</dt><dd className={`num ${live.downtime_day_min > snap.targets.downtime_min ? "warn" : ""}`}>{int(live.downtime_day_min)}<small> / {snap.targets.downtime_min} мин</small></dd></div>
              <div><dt>После ремонта</dt><dd className={`num ${fresh ? "" : "stale"}`}>{!data ? "—" : data.hours_since_repair >= 500 ? "более 500 ч" : `${int(data.hours_since_repair)} ч`}</dd></div>
            </dl>
          </div>
        )}

        {tab === "sensors" && (
          <div className={`pane dep ${fresh ? "" : "stale"}`} role="tabpanel" aria-label="Телеметрия">
            <h3>Вибрация, мм/с <b className="num">{dec(live.vib)}</b></h3>
            <LineChart key={`v${data?.id}`} fit series={[{ values: col("vib"), color: "var(--ink)" }]} xLabels={DAY}
              floor={base && span(0, base.vib + 2)} refLine={base && { value: base.vib, label: "норма" }} fmt={(v) => dec(v)} />
            <h3>Температура узла, °C <b className="num">{dec(live.temp)}</b></h3>
            <LineChart key={`t${data?.id}`} fit series={[{ values: col("temp"), color: "var(--ink)" }]} xLabels={DAY}
              floor={base && span(base.temp - 10, base.temp + 15)} refLine={base && { value: base.temp, label: "норма" }} fmt={(v) => int(v)} />
            <h3>Ток привода, А <b className="num">{dec(live.cur)}</b></h3>
            <LineChart key={`c${data?.id}`} fit series={[{ values: col("cur"), color: "var(--ink)" }]} xLabels={DAY}
              floor={base && span(0, base.cur * 1.3)} refLine={base && { value: base.cur, label: "норма" }} fmt={(v) => int(v)} />
          </div>
        )}

        {tab === "stops" && (
          <div className="pane" role="tabpanel" aria-label="Простои">
            <h3>Последние простои</h3>
            <div className={`mini-wrap dep ${fresh ? "" : "stale"}`}><table className="mini">
              <tbody>
                {events.map((e) => (
                  <tr key={e.start}><td className="num">{e.start.slice(8, 10)}.{e.start.slice(5, 7)} {hhmm(e.start)}</td><td>{e.cause}</td><td className="num r">{dur(e.minutes)}</td></tr>
                ))}
                {/* строк всегда поровну: таблица не меняет высоту от поста к посту */}
                {Array.from({ length: STOPS - events.length }, (_, i) => (
                  <tr key={i} className="blank"><td colSpan={3}>{i === 0 && data && !events.length ? "За период наблюдения простоев не было." : " "}</td></tr>
                ))}
              </tbody>
            </table></div>
            <h3>Операция</h3>
            <p className="op">{spec.op ?? "Описание операции не задано."}</p>
            <p className="op">{shop?.full ?? spec.shop} · {spec.asset}</p>
          </div>
        )}
      </div>
      <div className={`side-last inc ${latest ? `open ${latest.type} ${latest.severity}` : ""}`}>
        <button onClick={onClose} title="Открыть ленту инцидентов">
          <span className="inc-head">
            <span className="inc-type">{latest ? `${TYPE_LABEL[latest.type]} · открыто ${open.length}` : "Инциденты"}</span>
            {latest && <time className="num">{hhmm(latest.start)}</time>}
          </span>
          <strong title={latest?.title}>{latest ? latest.title : "Открытых инцидентов нет"}</strong>
        </button>
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
      <div className={selected ? "board-main has-sel" : "board-main"}>
        <section className="panel stage">
          <Mimic layout={layout} snap={snap} selected={selected} onSelect={onSelect} />
          <div className="under">
            <div>
              <div className="under-head">
                <h2>Выпуск по часам, шт</h2>
                <p className="key"><i className="k-fact" />факт <i className="k-plan" />план <i className="k-short" />ниже плана</p>
              </div>
              <PlanFact fit items={snap.hourly.map((h) => ({ label: hhmm(h.hour), fact: h.fact, plan: h.plan }))} />
            </div>
            <div className="bn-note">
              <h2>Узкое место</h2>
              {snap.bottleneck ? (
                <p><button className="link" onClick={() => onSelect(snap.bottleneck!.station)}>{snap.bottleneck.station} · {snap.bottleneck.name}</button>: {snap.bottleneck.reason}. Оценка за последние {dur(snap.bottleneck.window_min)}.</p>
              ) : <p className="muted">Поток сбалансирован: ни один пост не сдерживает соседей.</p>}
            </div>
          </div>
        </section>
        {/* на широком окне паспорт встаёт рядом с лентой, на узком заменяет её (styles.css) */}
        {selected && <Passport id={selected} layout={layout} snap={snap} onClose={() => onSelect(null)} />}
        <Feed snap={snap} onSelect={onSelect} />
      </div>
    </main>
  );
}
