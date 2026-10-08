import { useState } from "react";
import { ddmm, dec, dur, Executive, int, Layout, OrgData, pct, usePoll } from "./api";
import { Bars, LineChart, PlanFact } from "./charts";
import "./pages.css";

type Tab = "sum" | "loss" | "month" | "org" | "effect";
const TABS: [Tab, string][] = [
  ["sum", "Итоги"], ["loss", "Потери"], ["month", "План месяца"], ["org", "Данные организаторов"], ["effect", "Эффект"],
];
const PERIODS = [7, 30, 75];
// окно, по которому считаются план месяца и калькулятор: от переключателя периода они не зависят
const BASE_URL = "/api/executive?days=30";

interface Knobs { caught: number | null; saved: number; reach: number; price: string }
const DEFAULTS: Knobs = { caught: null, saved: 60, reach: 35, price: "" };
// по встречному прогону двойника до выпуска доходит 29–37 % простоя поста: остальное гасят накопители
const REACH_LO = 29, REACH_HI = 37;

// Состояние экрана живёт в модуле: App пересоздаёт экран при каждом входе, а вкладка, период
// и допущения калькулятора должны это пережить. Вкладку можно задать ссылкой: #exec@effect
const fromHash = window.location.hash.split("@")[1];
const mem = {
  tab: (TABS.some(([id]) => id === fromHash) ? fromHash : "sum") as Tab,
  days: 30,
  knobs: DEFAULTS,
};
function useMem<K extends keyof typeof mem>(key: K) {
  const [value, set] = useState(mem[key]);
  return [value, (next: (typeof mem)[K]) => { mem[key] = next; set(next); }] as const;
}

const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
};
const days = (n: number) => `${n} ${plural(n, "день", "дня", "дней")}`;

function Effect({ ex, knobs, onChange }: { ex: Executive; knobs: Knobs; onChange: (k: Knobs) => void }) {
  const m = ex.model;
  // пока ползунок не трогали, доля берётся из проверки модели и округляется до 5 %
  const byModel = Math.round(m.event_recall * 20) * 5;
  const caught = knobs.caught ?? byModel;
  const { saved, reach, price } = knobs;
  const perMonth = (ex.equip_downtime_h / ex.days) * 30;
  const hours = perMonth * (caught / 100) * (saved / 100);
  const units = hours * (reach / 100) * ex.units_per_hour;
  const span = (share: number) => int(hours * (share / 100) * ex.units_per_hour);
  const money = Number(price.replace(/\s/g, "").replace(",", ".")) * units;
  const touched = knobs.caught != null || saved !== DEFAULTS.saved || reach !== DEFAULTS.reach || price !== "";
  return (
    <section className="panel pad pg-pad effect">
      <p className="pg-lead pg-first">Предсказанный отказ превращается в короткое плановое обслуживание вместо аварийной остановки. Подвигайте допущения и посмотрите, что это даёт.</p>
      <div className="effect-grid pg-eg">
        <div className="knobs pg-knobs">
          <label>
            <span>Доля отказов, пойманных заранее: <b className="num">{caught} %</b></span>
            <input type="range" min={0} max={100} value={caught} onChange={(e) => onChange({ ...knobs, caught: +e.target.value })} />
            <small>По умолчанию {byModel} %: на проверке модель поймала {m.caught_failures} из {m.test_failures} отказов ({pct(m.event_recall, 0)} %), округлено до 5 %</small>
          </label>
          <label>
            <span>Насколько плановое ТО короче аварийного ремонта: <b className="num">{saved} %</b></span>
            <input type="range" min={0} max={100} value={saved} onChange={(e) => onChange({ ...knobs, saved: +e.target.value })} />
            <small>Допущение, уточняется у службы главного механика</small>
          </label>
          <label>
            <span>Доля простоя поста, которая доходит до выпуска: <b className="num">{reach} %</b></span>
            <input type="range" min={0} max={100} value={reach} onChange={(e) => onChange({ ...knobs, reach: +e.target.value })} />
            <small>по модели двойника {REACH_LO}–{REACH_HI} %: остальное гасят накопители</small>
          </label>
          <label>
            <span>Маржа на один автомобиль, ₸</span>
            <input type="text" inputMode="numeric" placeholder="введите, чтобы увидеть эффект в деньгах" value={price}
              onChange={(e) => onChange({ ...knobs, price: e.target.value })} />
          </label>
        </div>
        <div>
          <dl className="facts two pg-flush">
            <div><dt>Аварийные простои постов</dt><dd className="num">{dec(perMonth)} ч<small> в месяц</small></dd></div>
            <div><dt>Можно вернуть постам</dt><dd className="num">{dec(hours)} ч<small> в месяц</small></dd></div>
            <div><dt>Дополнительный выпуск</dt><dd className="num">{int(units)} авто<small> в месяц</small></dd></div>
            <div><dt>В деньгах</dt><dd className="num">{money > 0 ? `${int(money)} ₸` : "—"}<small>{money > 0 ? " в месяц" : ""}</small></dd></div>
          </dl>
          <p className="pg-range">При доле простоя {REACH_LO}–{REACH_HI} % те же допущения дают от <b className="num">{span(REACH_LO)}</b> до <b className="num">{span(REACH_HI)}</b> авто в месяц.</p>
          <p className={touched ? "pg-reset" : "pg-reset pg-off"}>
            <button className="link" onClick={() => onChange(DEFAULTS)}>Вернуть допущения по умолчанию</button>
          </p>
        </div>
      </div>
      <p className="muted pg-small">Расчёт: часы аварийных простоев постов × доля пойманных отказов × сокращение ремонта × доля простоя, доходящая до выпуска × средний темп линии ({dec(ex.units_per_hour)} шт/ч). Час простоя одного поста не равен часу простоя линии: большую часть потерь гасят накопители, поэтому введён третий множитель. Ложные тревоги (осмотр без отказа) в расчёт не входят. Часы простоя взяты за последние {days(ex.days)} синтетической истории, не из данных завода.</p>
    </section>
  );
}

function Month({ ex, onTab }: { ex: Executive; onTab: (t: Tab) => void }) {
  const m = ex.month, ok = m.projected >= m.plan;
  const byModels = m.models.reduce((s, x) => s + x.plan, 0);
  return (
    <section className="panel pad pg-pad">
      <dl className="facts strip pg-strip">
        <div><dt>Выпущено с начала месяца</dt><dd className="num">{int(m.fact)}<small> из {int(m.plan)}</small></dd></div>
        <div><dt>Прогноз на конец месяца</dt><dd className={`num ${ok ? "" : "warn"}`}>{int(m.projected)}<small> {ok ? "план будет выполнен" : "ниже плана"}</small></dd></div>
        <div><dt>Темп</dt><dd className="num">{dec(m.per_hour)}<small> авто в час</small></dd></div>
        <div><dt>По сменному плану за месяц</dt><dd className={`num ${m.shift_plan_total >= m.plan ? "" : "warn"}`}>{int(m.shift_plan_total)}<small> за {m.work_days} {plural(m.work_days, "рабочий день", "рабочих дня", "рабочих дней")}</small></dd></div>
      </dl>
      {m.shift_plan_total < m.plan && (
        <p className="callout pg-callout">Сменный план 120 автомобилей при {m.work_days} {plural(m.work_days, "рабочем дне", "рабочих днях", "рабочих днях")} даёт {int(m.shift_plan_total)} в месяц. Чтобы выйти на {int(m.plan)}, линия должна стабильно перевыполнять сменный план или работать дополнительные смены.</p>
      )}
      <div className="table-scroll pg-scroll">
        <table className="grid-table compact">
          <thead><tr><th>Модель</th><th className="r">План на месяц</th><th className="r">Выпущено</th><th className="r">Выполнение</th></tr></thead>
          <tbody>
            {m.models.map((x) => (
              <tr key={x.model}><td>{x.model}</td><td className="r num">{int(x.plan)}</td><td className="r num">{int(x.fact)}</td><td className="r num">{pct(x.fact / x.plan, 0)} %</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="notes pg-notes">
        <li>План по моделям взят из данных организаторов. Выпуск по моделям в двойнике распределяется в той же пропорции.</li>
        {byModels < m.plan && (
          <li>План по моделям в сумме {int(byModels)}, общий минимум на месяц {int(m.plan)}. Поэтому каждая модель может быть выполнена больше чем на 100 %, а месяц при этом останется ниже плана: расхождение заложено во вводных, см. сверку на вкладке <button className="link" onClick={() => onTab("org")}>«Данные организаторов»</button>.</li>
        )}
      </ul>
    </section>
  );
}

function Organizers({ layout }: { layout: Layout }) {
  const { data: org } = usePoll<OrgData>("/api/orgdata", 0);
  if (!org) return <p className="calm">Загружаю данные организаторов…</p>;
  if (!org.lines) return <section className="panel pad pg-pad"><p className="pg-lead pg-first">Файл организаторов не найден: сверка недоступна.</p></section>;
  const p1 = (x: number) => dec(x * 100);
  return (
    <section className="panel pad pg-pad">
      <p className="pg-lead pg-first">Таблицы из файла организаторов как есть и их сверка с нормативами. На этих данных настроена модель двойника.</p>
      <div className="cols pg-org">
        <div>
          <h3 className="pg-h3">Сверка с нормативами</h3>
          <ul className="checks pg-checks">
            {org.checks!.map((c) => (
              <li key={c.title} className={c.ok ? "ok" : "fail"}><i /><div><strong>{c.title}</strong><span>{c.text}</span></div></li>
            ))}
          </ul>
          <h3 className="pg-h3 pg-gap">Допущения при чтении данных</h3>
          <ul className="notes pg-notes">{org.assumptions!.map((a) => <li key={a}>{a}</li>)}</ul>
        </div>
        <div>
          <h3 className="pg-h3">Работа линий</h3>
          <div className="table-scroll pg-scroll">
            <table className="grid-table compact pg-tight">
              <thead><tr><th>Дата</th><th>Линия</th><th className="r">Факт / план</th><th className="r">Часы</th><th className="r">Брак</th><th className="r">OEE, оценка сверху</th></tr></thead>
              <tbody>
                {org.lines.map((r) => (
                  <tr key={r.date + r.line}>
                    <td className="num">{r.date.slice(0, 5)}</td><td>{r.line}</td>
                    <td className={`r num ${r.fact < r.plan ? "warn" : ""}`}>{r.fact} / {r.plan}</td><td className="r num">{dec(r.hours)}</td>
                    <td className={`r num ${r.defect != null && r.defect > 0.02 ? "warn" : ""}`}>{r.defect != null ? `${p1(r.defect)} %` : "—"}</td>
                    <td className="r num">{pct(r.oee, 0)} %</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted pg-small pg-under">OEE в этой таблице — оценка сверху: за полный темп принят плановый ({dec(layout.plan_per_hour)} шт/ч), а не паспортный ({dec(layout.nominal_per_hour)} шт/ч), качество взято по одному участку. На остальных вкладках OEE считается от паспортного темпа и по всей линии, поэтому он ниже.</p>
          <h3 className="pg-h3 pg-gap">Простои оборудования</h3>
          <div className="table-scroll pg-scroll">
            <table className="grid-table compact pg-tight">
              <thead><tr><th>Дата</th><th>Оборудование</th><th>Причина</th><th className="r">Минут</th></tr></thead>
              <tbody>
                {org.downtime!.map((r) => (
                  <tr key={r.date + r.equipment}><td className="num">{r.date.slice(0, 5)}</td><td>{r.equipment} · {r.shop}</td><td>{r.cause}</td><td className="r num">{r.minutes}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}

export function ExecutiveView({ layout, onOpen }: { layout: Layout; onOpen: (id: string) => void }) {
  const [tab, setTab] = useMem("tab");
  const [period, setPeriod] = useMem("days");
  const [knobs, setKnobs] = useMem("knobs");
  const { data: ex } = usePoll<Executive>(`/api/executive?days=${period}`, 30000);
  const { data: base } = usePoll<Executive>(BASE_URL, 30000);
  const byPeriod = tab === "sum" || tab === "loss";
  const title = tab === "sum" ? (ex ? `Итоги за ${days(ex.days)}` : "Итоги")
    : tab === "loss" ? (ex ? `Потери за ${days(ex.days)}` : "Потери")
    : tab === "month" ? "План месяца" : tab === "org" ? "Данные организаторов" : "Эффект от прогноза";
  const shopName = (id: string) => layout.shops.find((s) => s.id === id)?.name ?? id;
  const wait = <p className="calm">Считаю показатели за период…</p>;

  const summary = () => {
    if (!ex) return wait;
    const t = ex.total;
    const done = t.plan ? t.fact / t.plan : 1;
    const xl = ex.daily.length ? [ddmm(ex.daily[0].date), ddmm(ex.daily[Math.floor(ex.daily.length / 2)].date), ddmm(ex.daily[ex.daily.length - 1].date)] : undefined;
    return (
      <>
        <section className="panel pad pg-pad">
          <dl className="facts strip pg-strip">
            <div><dt>Выпуск и план</dt><dd className="num">{int(t.fact)}<small> из {int(t.plan)}</small></dd></div>
            <div><dt>Выполнение плана</dt><dd className={`num ${done < 0.95 ? "warn" : ""}`}>{pct(done)} %</dd></div>
            <div><dt>OEE линии, цель {pct(ex.targets.oee, 0)} %</dt><dd className={`num ${t.oee < ex.targets.oee ? "warn" : ""}`}>{pct(t.oee)} %</dd></div>
            <div><dt>Готовность оборудования</dt><dd className="num">{pct(t.availability)} %</dd></div>
            <div><dt>Выход с первого раза</dt><dd className="num">{pct(t.quality)} %</dd></div>
            <div><dt>Простои постов</dt><dd className="num">{dec(t.downtime_min / 60)} ч</dd></div>
            <div><dt>Недовыпуск к плану</dt><dd className={`num ${ex.shortfall ? "warn" : ""}`}>{int(ex.shortfall)} авто</dd></div>
          </dl>
        </section>
        <div className="cols pg-even">
          <section className="panel pad pg-pad">
            <h2>Выпуск по дням, шт</h2>
            <div className="pg-chart"><PlanFact fit items={ex.daily.map((d) => ({ label: ddmm(d.date), fact: d.fact, plan: d.plan }))} /></div>
            <p className="key"><i className="k-fact" />факт <i className="k-plan" />план <i className="k-short" />ниже плана</p>
          </section>
          <section className="panel pad pg-pad">
            <h2>OEE и его составляющие, %</h2>
            <div className="pg-chart">
              <LineChart fit xLabels={xl} fmt={(v) => `${Math.round(v * 100)}`} max={1}
                refLine={{ value: ex.targets.oee, label: `цель OEE ${pct(ex.targets.oee, 0)} %` }}
                series={[
                  { values: ex.daily.map((d) => d.oee), color: "var(--ink)", width: 2.5 },
                  { values: ex.daily.map((d) => d.performance), color: "var(--plan)" },
                  { values: ex.daily.map((d) => d.quality), color: "var(--ok-ink)" },
                ]} />
            </div>
            <p className="key"><i style={{ background: "var(--ink)" }} />OEE <i style={{ background: "var(--plan)" }} />темп <i style={{ background: "var(--ok-ink)" }} />качество</p>
          </section>
        </div>
      </>
    );
  };

  const losses = () => {
    if (!ex) return wait;
    const worst = [...ex.stations].sort((a, b) => b.downtime_min - a.downtime_min).slice(0, 8);
    return (
      <>
        <div className="cols pg-even">
          <section className="panel pad pg-pad pg-bars">
            <div className="pg-h2row"><h2>На что уходит время простоев</h2><span>причины по убыванию потерь, справа накопленная доля</span></div>
            <Bars items={ex.pareto.map((p) => ({ label: p.cause, value: p.minutes, text: dur(p.minutes) }))} />
          </section>
          <section className="panel pad pg-pad">
            <h2>Цеха</h2>
            <div className="table-scroll pg-scroll">
              <table className="grid-table compact pg-tight">
                <thead><tr><th>Участок</th><th className="r">OEE</th><th className="r">Брак, норма {pct(ex.targets.defect, 0)} %</th><th className="r">Простои</th><th className="r">Отказов</th></tr></thead>
                <tbody>
                  {ex.shops.map((s) => (
                    <tr key={s.id}><td>{s.name}</td><td className="r num">{pct(s.oee)} %</td><td className={`r num ${s.defect_rate > ex.targets.defect ? "warn" : ""}`}>{pct(s.defect_rate)} %</td><td className="r num">{dur(s.downtime_min)}</td><td className="r num">{s.failures}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <section className="panel pad pg-pad">
          <h2>Посты с наибольшими потерями</h2>
          <div className="table-scroll pg-scroll">
            <table className="grid-table compact pg-tight">
              <thead><tr><th>Пост</th><th>Цех</th><th className="r">Простои</th><th className="r">Отказов</th><th className="r">Наработка на отказ</th><th className="r">Среднее восстановление</th><th className="r">OEE</th><th className="r">Брак, шт</th></tr></thead>
              <tbody>
                {worst.map((s) => (
                  <tr key={s.id}>
                    <td><button className="link" onClick={() => onOpen(s.id)}>{s.id} · {s.name}</button></td>
                    <td>{shopName(s.shop)}</td>
                    <td className="r num">{dur(s.downtime_min)}</td><td className="r num">{s.failures}</td>
                    <td className="r num">{s.mtbf_h != null ? `${int(s.mtbf_h)} ч` : "—"}</td>
                    <td className="r num">{s.mttr_min != null ? dur(s.mttr_min) : "—"}</td>
                    <td className="r num">{pct(s.oee)} %</td><td className="r num">{int(s.defects)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </>
    );
  };

  return (
    <main className="page">
      <div className="pg-root">
        <div className="pg-bar">
          <h1>{title}</h1>
          <div className="pg-tabs" role="tablist" aria-label="Разделы отчёта">
            {TABS.map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>{label}</button>
            ))}
          </div>
          {/* период относится только к итогам и потерям; место остаётся занятым, чтобы вкладки не сдвигались */}
          <div className={byPeriod ? "chips pg-period" : "chips pg-period pg-off"} role="group" aria-label="Период">
            {PERIODS.map((d) => (
              <button key={d} className={period === d ? "on" : ""} aria-pressed={period === d} onClick={() => setPeriod(d)}>{d} дней</button>
            ))}
          </div>
        </div>
        <div className="pg-tab" role="tabpanel" aria-label={TABS.find(([id]) => id === tab)![1]}>
          {tab === "sum" && summary()}
          {tab === "loss" && losses()}
          {tab === "month" && (base ? <Month ex={base} onTab={setTab} /> : wait)}
          {tab === "org" && <Organizers layout={layout} />}
          {tab === "effect" && (base ? <Effect ex={base} knobs={knobs} onChange={setKnobs} /> : wait)}
        </div>
      </div>
    </main>
  );
}
