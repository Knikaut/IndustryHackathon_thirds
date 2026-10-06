import { dec, dur, Executive, int, Layout, pct, Snapshot, usePoll } from "./api";
import { LineChart } from "./charts";

export function ForecastView({
  layout, snap, onOpen,
}: { layout: Layout; snap: Snapshot; onOpen: (id: string) => void }) {
  const { data: ex } = usePoll<Executive>("/api/executive?days=30", 60000);
  const shop = (id: string) => layout.shops.find((s) => s.id === id)?.name ?? id;
  const m = ex?.model;
  return (
    <main className="page">
      <section className="panel pad">
        <h1>Где линия может встать в ближайшие {snap.horizon_h} часов</h1>
        <p className="lead">Модель каждые пять минут пересчитывает риск отказа по телеметрии постов: вибрации, температуре, току привода и времени цикла. Порог тревоги: {pct(snap.threshold, 0)} %.</p>
        <div className="table-scroll">
          <table className="grid-table">
            <thead>
              <tr><th>Пост</th><th>Риск</th><th>Динамика за 12 ч</th><th>Что видит модель</th><th>Что сделать</th></tr>
            </thead>
            <tbody>
              {snap.forecast.map((f) => {
                const level = f.risk >= snap.threshold ? "high" : f.risk >= 0.1 ? "elevated" : "low";
                return (
                  <tr key={f.station} className={level}>
                    <td>
                      <button className="link" onClick={() => onOpen(f.station)}>{f.station} · {f.name}</button>
                      <span className="muted block">{shop(f.shop)} · {f.asset}</span>
                    </td>
                    <td className="risk-cell">
                      <b className="num">{pct(f.risk, 0)} %</b>
                      <i className="meter"><i style={{ transform: `scaleX(${f.risk})` }} /></i>
                    </td>
                    <td className="spark-cell">
                      <LineChart height={56} min={0} max={1} area series={[{ values: f.history, color: "var(--ai)" }]}
                        refLine={{ value: snap.threshold, label: "", color: "var(--ai)" }} fmt={(v) => `${Math.round(v * 100)}`} />
                    </td>
                    <td>
                      {f.factors.length
                        ? <ul className="factors">{f.factors.map((x) => <li key={x.key}>{x.label}: <b className="num">{x.value}</b></li>)}</ul>
                        : <span className="muted">Сигналы в норме</span>}
                    </td>
                    <td>{level === "low" ? <span className="muted">Действий не требуется</span> : f.action}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <div className="cols">
        <section className="panel pad">
          <h2>Накопители и узкие места</h2>
          {snap.bottleneck ? (
            <p className="callout">Узкое место сейчас: <button className="link" onClick={() => onOpen(snap.bottleneck!.station)}>{snap.bottleneck.station} · {snap.bottleneck.name}</button>. {snap.bottleneck.reason[0].toUpperCase() + snap.bottleneck.reason.slice(1)}.</p>
          ) : <p className="muted">Узких мест не обнаружено: поток сбалансирован.</p>}
          {snap.buffers.map((b) => (
            <div key={b.id} className="buf">
              <h3>{b.name}</h3>
              <p>
                <b className="num">{b.level}</b> из {b.cap} мест
                {b.direction === "stable" ? ", уровень стабилен." : (
                  <>, {b.direction === "filling" ? "заполняется" : "пустеет"} на <b className="num">{dec(Math.abs(b.per_hour))}</b> шт/ч.
                    {b.eta_min != null && <> При таком темпе {b.direction === "filling" ? "заполнится, и предыдущий цех встанет," : "опустеет, и следующий цех останется без кузовов,"} через <b className="num">{dur(b.eta_min)}</b>.</>}</>
                )}
              </p>
              <LineChart height={90} min={0} max={b.cap} area series={[{ values: b.history, color: "var(--ink)" }]}
                xLabels={["12 ч назад", "6 ч", "сейчас"]} fmt={(v) => int(v)} />
            </div>
          ))}
        </section>

        <section className="panel pad">
          <h2>Насколько модели можно верить</h2>
          {m ? (
            <>
              <dl className="facts two">
                <div><dt>Отказов предсказано заранее</dt><dd className="num">{m.caught_failures} из {m.test_failures}<small> ({pct(m.event_recall, 0)} %)</small></dd></div>
                <div><dt>Медианное упреждение</dt><dd className="num">{m.lead_h != null ? `${dec(m.lead_h)} ч` : "—"}</dd></div>
                <div><dt>Точность тревог</dt><dd className="num">{pct(m.precision, 0)} %</dd></div>
                <div><dt>ROC-AUC</dt><dd className="num">{m.roc_auc.toFixed(2).replace(".", ",")}</dd></div>
              </dl>
              <p>Проверка честная: модель обучена на первых 75 % истории и проверена на последних 25 %, которых она не видела. Всего в истории {m.failures_total} отказов оборудования, {int(m.train_rows)} обучающих наблюдений.</p>
              <p className="muted">Алгоритм: {m.algorithm}. Признаки считаются относительно нормы самого поста, поэтому модель переносится на новое оборудование без переобучения с нуля.</p>
              <p className="muted">Цифры получены на синтетических данных. На реальных данных завода качество будет другим, и его нужно измерить заново тем же способом.</p>
            </>
          ) : <p className="muted">Загружаю метрики модели…</p>}
        </section>
      </div>
    </main>
  );
}
