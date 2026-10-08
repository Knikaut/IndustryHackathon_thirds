import { dec, dur, Executive, Factor, int, Layout, pct, Snapshot, usePoll } from "./api";
import { LineChart } from "./charts";
import "./pages.css";

// сигналы стоят в постоянном порядке, а не по весу: слот не меняет содержимое от такта к такту
const SIGNALS = ["vib", "trend", "temp", "cur", "cyc", "fails"];
const rank = (f: Factor) => { const i = SIGNALS.indexOf(f.key); return i < 0 ? SIGNALS.length : i; };
const BUF_X = ["12 ч работы назад", "6 ч", "сейчас"];

/** Границы доли k из n с доверием 95 % (интервал Уилсона): при малом n доля известна грубо. */
function wilson(k: number, n: number) {
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const mid = (p + (z * z) / (2 * n)) / d, half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, mid - half), Math.min(1, mid + half)];
}

export function ForecastView({
  layout, snap, onOpen,
}: { layout: Layout; snap: Snapshot; onOpen: (id: string) => void }) {
  const { data: ex } = usePoll<Executive>("/api/executive?days=30", 60000);
  const shop = (id: string) => layout.shops.find((s) => s.id === id)?.name ?? id;
  const m = ex?.model;
  const ci = m && m.test_failures > 0 ? wilson(m.caught_failures, m.test_failures) : null;
  const bn = snap.bottleneck;
  return (
    <main className="page">
      <div className="pg-root">
        <section className="panel pad pg-pad">
          <div className="pg-head">
            <h1>Где линия может встать в ближайшие {snap.horizon_h} часов работы</h1>
            <p className="pg-lead">Модель каждые пять минут пересчитывает риск отказа по телеметрии постов: вибрации, температуре, току привода и времени цикла. Порог тревоги: {pct(snap.threshold, 0)} %.</p>
          </div>
          <div className="table-scroll pg-scroll">
            <table className="grid-table pg-fc">
              <colgroup><col className="pg-c-post" /><col className="pg-c-risk" /><col className="pg-c-spark" /><col className="pg-c-why" /><col /></colgroup>
              <thead>
                <tr><th>Пост</th><th>Риск</th><th>Риск за 12 ч работы, %</th><th>Что видит модель</th><th>Что сделать</th></tr>
              </thead>
              <tbody>
                {snap.forecast.map((f) => {
                  // уровень тот же, что на «Щите»: сервер держит его с гистерезисом, строка не мигает у порога
                  const level = snap.stations.find((s) => s.id === f.station)?.risk_level
                    ?? (f.risk >= snap.threshold ? "high" : f.risk >= 0.1 ? "elevated" : "low");
                  const factors = [...f.factors].sort((a, b) => rank(a) - rank(b)).slice(0, 3);
                  const post = `${f.station} · ${f.name}`, where = `${shop(f.shop)} · ${f.asset}`;
                  return (
                    <tr key={f.station} className={level === "high" ? "pg-high" : level === "elevated" ? "pg-elev" : undefined}>
                      <td>
                        <div className="pg-cell">
                          <button className="link" title={post} onClick={() => onOpen(f.station)}>{post}</button>
                          <span className="muted pg-one" title={where}>{where}</span>
                        </div>
                      </td>
                      <td>
                        <div className="pg-cell pg-risk">
                          <b className="num">{pct(f.risk, 0)} %</b>
                          <i className="pg-meter"><i style={{ transform: `scaleX(${Math.max(0, Math.min(1, f.risk))})` }} /></i>
                        </div>
                      </td>
                      <td>
                        <div className="pg-cell">
                          <LineChart fit height={42} min={0} max={1} area series={[{ values: f.history, color: "var(--ai)" }]}
                            refLine={{ value: snap.threshold, label: "", color: "var(--ai)" }} fmt={(v) => `${Math.round(v * 100)}`} />
                        </div>
                      </td>
                      <td>
                        <div className="pg-cell">
                          {factors.length ? (
                            <ul className="pg-factors">
                              {factors.map((x) => <li key={x.key} title={`${x.label}: ${x.value}`}><span>{x.label}</span><b className="num">{x.value}</b></li>)}
                            </ul>
                          ) : <span className="muted">Сигналы в норме</span>}
                        </div>
                      </td>
                      <td>
                        <div className="pg-cell">
                          {level === "low" ? <span className="muted">Действий не требуется</span> : <span className="pg-act" title={f.action}>{f.action}</span>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <div className="cols pg-even">
          <section className="panel pad pg-pad">
            <h2>Накопители и узкие места</h2>
            {bn ? (
              <p className="pg-note pg-on"><span>Узкое место сейчас: <button className="link" onClick={() => onOpen(bn.station)}>{bn.station} · {bn.name}</button>. {bn.reason[0].toUpperCase() + bn.reason.slice(1)}.</span></p>
            ) : <p className="pg-note"><span>Узких мест не обнаружено: поток сбалансирован.</span></p>}
            <div className="pg-bufs">
              {snap.buffers.map((b) => (
                <div key={b.id} className="pg-buf">
                  <h3 className="pg-h3">{b.name}</h3>
                  {/* две строки постоянной высоты: смена текста прогноза не двигает графики */}
                  <p className="pg-buf-eta">
                    <span>
                      <b className="num">{b.level}</b> из {b.cap} мест
                      {b.direction !== "stable" && <>, {b.direction === "filling" ? "заполняется" : "пустеет"} на <b className="num">{dec(Math.abs(b.per_hour))}</b> шт/ч</>}
                    </span>
                    <span>
                      {b.direction === "stable" ? "Уровень стабилен."
                        : b.eta_min != null
                          ? <>Через <b className="num">{dur(b.eta_min)}</b> {b.direction === "filling" ? "предыдущий цех встанет" : "следующий цех останется без кузовов"}.</>
                          : "\u00a0"}
                    </span>
                  </p>
                  <LineChart fit height={100} min={0} max={b.cap} area series={[{ values: b.history, color: "var(--ink)" }]}
                    xLabels={BUF_X} fmt={(v) => int(v)} />
                </div>
              ))}
            </div>
          </section>

          <section className="panel pad pg-pad pg-trust">
            <h2>Насколько модели можно верить</h2>
            {m ? (
              <>
                <dl className="facts pg-facts4">
                  <div><dt>Поймано отказов</dt><dd className="num">{m.caught_failures} из {m.test_failures}<small> ({pct(m.event_recall, 0)} %)</small></dd></div>
                  <div><dt>Медианное упреждение</dt><dd className="num">{m.lead_h != null ? <>{dec(m.lead_h)}<small> ч работы</small></> : "—"}</dd></div>
                  <div><dt>Точность тревог</dt><dd className="num">{pct(m.precision, 0)} %</dd></div>
                  <div><dt>ROC-AUC</dt><dd className="num">{m.roc_auc.toFixed(2).replace(".", ",")}</dd></div>
                </dl>
                <p>Метод проверки: модель обучена на первых 75 % истории, проверена на последних 25 %, которых не видела. В проверке {m.test_failures} {plural(m.test_failures, "отказ", "отказа", "отказов")}, заранее {plural(m.caught_failures, "предсказан", "предсказаны", "предсказано")} {m.caught_failures}{ci && <>; при таком числе событий доля известна грубо: от {pct(ci[0], 0)} до {pct(ci[1], 0)} % с доверием 95 %</>}. Всего в истории {m.failures_total} {plural(m.failures_total, "отказ", "отказа", "отказов")} оборудования, {int(m.train_rows)} обучающих наблюдений.</p>
                <p className="muted pg-small">Алгоритм: {m.algorithm}. Признаки нормированы на норму поста; перенос на другое оборудование на реальных данных не проверялся.</p>
                <p className="muted pg-small">Цифры получены на синтетических данных. На реальных данных завода качество будет другим, и его нужно измерить заново тем же способом.</p>
              </>
            ) : <p className="muted">Загружаю метрики модели…</p>}
          </section>
        </div>
      </div>
    </main>
  );
}

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100, b = a % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b >= 2 && b <= 4 ? few : many;
}
