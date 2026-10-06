import { useState } from "react";
import { ddmm, dec, dur, Executive, int, Layout, OrgData, pct, usePoll } from "./api";
import { Bars, LineChart, PlanFact } from "./charts";

function Effect({ ex }: { ex: Executive }) {
  const [caught, setCaught] = useState(Math.round(ex.model.event_recall * 100));
  const [saved, setSaved] = useState(60);
  const [price, setPrice] = useState("");
  const perMonth = (ex.equip_downtime_h / ex.days) * 30;
  const hours = perMonth * (caught / 100) * (saved / 100);
  const units = hours * ex.units_per_hour;
  const money = Number(price.replace(/\s/g, "").replace(",", ".")) * units;
  return (
    <section className="panel pad effect">
      <h2>Оценка эффекта от прогноза</h2>
      <p className="lead">Предсказанный отказ превращается в короткое плановое обслуживание вместо аварийной остановки. Подвигайте допущения и посмотрите, что это даёт.</p>
      <div className="effect-grid">
        <div className="knobs">
          <label>
            <span>Доля отказов, пойманных заранее: <b className="num">{caught} %</b></span>
            <input type="range" min={0} max={100} value={caught} onChange={(e) => setCaught(+e.target.value)} />
            <small>Модель на проверке поймала {pct(ex.model.event_recall, 0)} %</small>
          </label>
          <label>
            <span>Насколько плановое ТО короче аварийного ремонта: <b className="num">{saved} %</b></span>
            <input type="range" min={0} max={100} value={saved} onChange={(e) => setSaved(+e.target.value)} />
            <small>Допущение, уточняется у службы главного механика</small>
          </label>
          <label>
            <span>Маржа на один автомобиль, ₸</span>
            <input type="text" inputMode="numeric" placeholder="введите, чтобы увидеть эффект в деньгах" value={price}
              onChange={(e) => setPrice(e.target.value)} />
          </label>
        </div>
        <dl className="facts two">
          <div><dt>Аварийные простои оборудования</dt><dd className="num">{dec(perMonth)} ч<small> в месяц</small></dd></div>
          <div><dt>Можно вернуть</dt><dd className="num">{dec(hours)} ч<small> в месяц</small></dd></div>
          <div><dt>Дополнительный выпуск</dt><dd className="num">{int(units)} авто<small> в месяц</small></dd></div>
          <div><dt>В деньгах</dt><dd className="num">{money > 0 ? `${int(money)} ₸` : "—"}<small>{money > 0 ? " в месяц" : ""}</small></dd></div>
        </dl>
      </div>
      <p className="muted">Расчёт: часы простоя × доля пойманных отказов × сокращение ремонта × средний темп линии ({dec(ex.units_per_hour)} шт/ч). Исходные часы простоя взяты из синтетической истории, не из данных завода.</p>
    </section>
  );
}

function Month({ ex }: { ex: Executive }) {
  const m = ex.month, ok = m.projected >= m.plan;
  return (
    <section className="panel pad">
      <h2>План месяца</h2>
      <dl className="facts strip">
        <div><dt>Выпущено с начала месяца</dt><dd className="num">{int(m.fact)}<small> из {int(m.plan)}</small></dd></div>
        <div><dt>Прогноз на конец месяца</dt><dd className={`num ${ok ? "" : "warn"}`}>{int(m.projected)}<small> {ok ? "план будет выполнен" : "ниже плана"}</small></dd></div>
        <div><dt>Темп</dt><dd className="num">{dec(m.per_hour)}<small> авто в час</small></dd></div>
        <div><dt>По сменному плану за месяц</dt><dd className={`num ${m.shift_plan_total >= m.plan ? "" : "warn"}`}>{int(m.shift_plan_total)}<small> за {m.work_days} рабочих дня</small></dd></div>
      </dl>
      {m.shift_plan_total < m.plan && (
        <p className="callout">Сменный план 120 автомобилей при {m.work_days} рабочих днях даёт {int(m.shift_plan_total)} в месяц. Чтобы выйти на {int(m.plan)}, линия должна стабильно перевыполнять сменный план или работать дополнительные смены.</p>
      )}
      <div className="table-scroll">
        <table className="grid-table compact">
          <thead><tr><th>Модель</th><th className="r">План на месяц</th><th className="r">Выпущено</th><th className="r">Выполнение</th></tr></thead>
          <tbody>
            {m.models.map((x) => (
              <tr key={x.model}><td>{x.model}</td><td className="r num">{int(x.plan)}</td><td className="r num">{int(x.fact)}</td><td className="r num">{pct(x.fact / x.plan, 0)} %</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted">План по моделям взят из данных организаторов. Выпуск по моделям в двойнике распределяется в той же пропорции.</p>
    </section>
  );
}

function Organizers() {
  const { data: org } = usePoll<OrgData>("/api/orgdata", 0);
  if (!org?.lines) return null;
  const p1 = (x: number) => dec(x * 100);
  return (
    <section className="panel pad">
      <h2>Тестовые данные организаторов</h2>
      <p className="lead">Таблицы из файла организаторов как есть и их сверка с нормативами. На этих данных настроена модель двойника.</p>
      <ul className="checks">
        {org.checks!.map((c) => (
          <li key={c.title} className={c.ok ? "ok" : "fail"}><i /><div><strong>{c.title}</strong><span>{c.text}</span></div></li>
        ))}
      </ul>
      <div className="cols org">
        <div className="table-scroll">
          <h3>Работа линий</h3>
          <table className="grid-table compact">
            <thead><tr><th>Дата</th><th>Линия</th><th className="r">Факт / план</th><th className="r">Часы</th><th className="r">Брак</th><th className="r">OEE, оценка</th></tr></thead>
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
        <div className="table-scroll">
          <h3>Простои оборудования</h3>
          <table className="grid-table compact">
            <thead><tr><th>Дата</th><th>Оборудование</th><th>Причина</th><th className="r">Минут</th></tr></thead>
            <tbody>
              {org.downtime!.map((r) => (
                <tr key={r.date + r.equipment}><td className="num">{r.date.slice(0, 5)}</td><td>{r.equipment} · {r.shop}</td><td>{r.cause}</td><td className="r num">{r.minutes}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <h3>Допущения при чтении данных</h3>
      <ul className="notes">{org.assumptions!.map((a) => <li key={a}>{a}</li>)}</ul>
    </section>
  );
}

export function ExecutiveView({ layout, onOpen }: { layout: Layout; onOpen: (id: string) => void }) {
  const [days, setDays] = useState(30);
  const { data: ex } = usePoll<Executive>(`/api/executive?days=${days}`, 30000);
  if (!ex) return <main className="page"><p className="calm">Считаю показатели за период…</p></main>;
  const t = ex.total;
  const done = t.plan ? t.fact / t.plan : 1;
  const shopName = (id: string) => layout.shops.find((s) => s.id === id)?.name ?? id;
  const worst = [...ex.stations].sort((a, b) => b.downtime_min - a.downtime_min).slice(0, 8);
  const xl = ex.daily.length ? [ddmm(ex.daily[0].date), ddmm(ex.daily[Math.floor(ex.daily.length / 2)].date), ddmm(ex.daily[ex.daily.length - 1].date)] : undefined;
  return (
    <main className="page">
      <section className="panel pad">
        <div className="head-row">
          <h1>Итоги за {ex.days} {ex.days % 10 === 1 && ex.days !== 11 ? "день" : "дней"}</h1>
          <div className="chips" role="group" aria-label="Период">
            {[7, 30, 75].map((d) => (
              <button key={d} className={days === d ? "on" : ""} aria-pressed={days === d} onClick={() => setDays(d)}>{d} дней</button>
            ))}
          </div>
        </div>
        <dl className="facts strip">
          <div><dt>Выпуск</dt><dd className="num">{int(t.fact)}<small> из {int(t.plan)} по плану</small></dd></div>
          <div><dt>Выполнение плана</dt><dd className={`num ${done < 0.95 ? "warn" : ""}`}>{pct(done)} %</dd></div>
          <div><dt>OEE линии, цель {pct(ex.targets.oee, 0)} %</dt><dd className={`num ${t.oee < ex.targets.oee ? "warn" : ""}`}>{pct(t.oee)} %</dd></div>
          <div><dt>Готовность оборудования</dt><dd className="num">{pct(t.availability)} %</dd></div>
          <div><dt>Выход с первого раза</dt><dd className="num">{pct(t.quality)} %</dd></div>
          <div><dt>Простои постов</dt><dd className="num">{dec(t.downtime_min / 60)} ч</dd></div>
          <div><dt>Недовыпуск к плану</dt><dd className={`num ${ex.shortfall ? "warn" : ""}`}>{int(ex.shortfall)} авто</dd></div>
        </dl>
      </section>

      <div className="cols">
        <section className="panel pad">
          <h2>Выпуск по дням, шт</h2>
          <PlanFact height={190} items={ex.daily.map((d) => ({ label: ddmm(d.date), fact: d.fact, plan: d.plan }))} />
          <p className="key"><i className="k-fact" />факт <i className="k-plan" />план <i className="k-short" />ниже плана</p>
        </section>
        <section className="panel pad">
          <h2>OEE и его составляющие, %</h2>
          <LineChart height={190} xLabels={xl} fmt={(v) => `${Math.round(v * 100)}`} max={1}
            refLine={{ value: ex.targets.oee, label: `цель OEE ${pct(ex.targets.oee, 0)} %` }}
            series={[
              { values: ex.daily.map((d) => d.oee), color: "var(--ink)", width: 2.5 },
              { values: ex.daily.map((d) => d.performance), color: "var(--plan)" },
              { values: ex.daily.map((d) => d.quality), color: "var(--ok-ink)" },
            ]} />
          <p className="key"><i style={{ background: "var(--ink)" }} />OEE <i style={{ background: "var(--plan)" }} />темп <i style={{ background: "var(--ok-ink)" }} />качество</p>
        </section>
      </div>

      <div className="cols">
        <section className="panel pad">
          <h2>На что уходит время простоев</h2>
          <p className="lead">Причины по убыванию потерь. Правый столбец показывает накопленную долю.</p>
          <Bars items={ex.pareto.map((p) => ({ label: p.cause, value: p.minutes, text: dur(p.minutes) }))} />
        </section>
        <section className="panel pad">
          <h2>Цеха</h2>
          <div className="table-scroll">
            <table className="grid-table compact">
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

      <section className="panel pad">
        <h2>Посты с наибольшими потерями</h2>
        <div className="table-scroll">
          <table className="grid-table compact">
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

      <Month ex={ex} />
      <Organizers />
      <Effect key={ex.days} ex={ex} />
    </main>
  );
}
