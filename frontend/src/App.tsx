import { Component, lazy, ReactNode, Suspense, useMemo, useState } from "react";
import { hhmm, ddmm, Layout, post, Snapshot, usePoll } from "./api";
import { Board } from "./Board";
import { ExecutiveView } from "./Executive";
import { ForecastView } from "./Forecast";

type View = "board" | "twin" | "forecast" | "exec";
const VIEWS: [View, string][] = [["board", "Щит"], ["twin", "Завод 3D"], ["forecast", "Прогноз"], ["exec", "Руководителю"]];

// экран перерисовывается раз в такт: ответ с тем же временем модели и той же паузой не меняет состояние
const sameTick = (a: Snapshot, b: Snapshot) => a.clock === b.clock && a.paused === b.paused && a.tick_seconds === b.tick_seconds;

/** Сбой одного экрана (нет WebGL, не загрузился чанк, ошибка отрисовки) не гасит шапку и вкладки. */
class ScreenGuard extends Component<{ children: ReactNode; hash: string; onRetry: () => void; hidden?: boolean }, { failed: boolean; chunk: boolean }> {
  state = { failed: false, chunk: false };
  static getDerivedStateFromError(error: unknown) {
    // незагруженный модуль браузер запоминает и повторно не запрашивает: помогает только перезагрузка страницы
    return { failed: true, chunk: /dynamically imported module|module script/i.test(String((error as Error)?.message ?? error)) };
  }
  componentDidCatch(error: unknown) { console.error(error); }
  reload = () => { window.location.hash = this.props.hash; window.location.reload(); };
  retry = () => {
    if (this.state.chunk) return this.reload();
    this.props.onRetry();
    this.setState({ failed: false });
  };
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.props.hidden) return null;
    return (
      <main className="page">
        <section className="panel pad" role="alert">
          <h1>Экран не открылся</h1>
          <p className="lead">Остальные разделы работают: выберите другой во вкладках сверху или повторите. Трёхмерной сцене нужен WebGL: если он отключён в браузере, откройте «Щит».</p>
          <div className="btns">
            <button onClick={this.retry}>Повторить</button>
            {!this.state.chunk && <button onClick={this.reload}>Перезагрузить страницу</button>}
          </div>
        </section>
      </main>
    );
  }
}

export function App() {
  // прямая ссылка на экран и пост: #twin, #twin/W3, #forecast
  const [hashView, hashStation] = window.location.hash.slice(1).split("@")[0].split("/");
  const [view, setView] = useState<View>(VIEWS.some(([id]) => id === hashView) ? (hashView as View) : "board");
  const [selected, setSelected] = useState<string | null>(hashStation || null);
  // после неудачной загрузки сцену нужно запросить заново: lazy запоминает и ошибку тоже
  const [attempt, setAttempt] = useState(0);
  // открытая сцена не размонтируется при уходе на другой экран, а прячется: подписи постов живут
  // в своих корнях React и при размонтировании холста падают с ошибкой, а возврат на сцену мгновенный
  const [twinLive, setTwinLive] = useState(false);
  const Twin3D = useMemo(() => lazy(() => import("./Twin3D")), [attempt]);
  const { data: layout, error: layoutErr } = usePoll<Layout>("/api/layout", 0);
  const { data: snap, error } = usePoll<Snapshot>("/api/state", 500, { same: sameTick });

  if (!layout || !snap) {
    return (
      <div className="boot">
        <h1>Двойник завода</h1>
        <p>{error || layoutErr
          ? "Жду сервер данных: при запуске он собирает историю и обучает модель. Если ожидание затянулось, запустите бэкенд: uvicorn app.main:app --port 8000"
          : "Собираю историю и обучаю модель прогноза…"}</p>
      </div>
    );
  }

  const open = (id: View) => { setView(id); window.scrollTo(0, 0); };
  const openStation = (id: string) => { setSelected(id); open("board"); };
  const openCount = snap.incidents.filter((i) => i.open).length;
  // пост из ссылки может не существовать: паспорт открываем только для поста со схемы
  const station = layout.stations.some((s) => s.id === selected) ? selected : null;
  const note = `${snap.source.label}. ${snap.source.note} Время ускорено в ${snap.speed} раз${snap.paused ? ", сейчас на паузе" : ""}.`;

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <strong>Двойник завода</strong>
          <span>АЛЛЮР · кейс №2</span>
        </div>
        <nav aria-label="Разделы">
          {VIEWS.map(([id, label]) => (
            <button key={id} className={view === id ? "on" : ""} aria-current={view === id ? "page" : undefined}
              onClick={() => open(id)}>
              {label}
              {id === "board" && <b className={openCount ? "count num" : "count num none"} aria-hidden={!openCount}>{openCount}</b>}
            </button>
          ))}
        </nav>
        <div className="status">
          <div className="shift">
            <span>{snap.shift.name}</span>
            <i className="shift-bar"><i style={{ width: `${snap.shift.progress * 100}%` }} /></i>
            <span className="num">{hhmm(snap.shift.start)}–{hhmm(snap.shift.end)}</span>
          </div>
          <div className="clock num" aria-label="Время модели">
            {hhmm(snap.clock)}<small>{ddmm(snap.clock)}</small>
          </div>
          <button className="ghost pause" title={snap.source.note}
            onClick={() => post(`/api/demo/speed?tick_seconds=${snap.tick_seconds}&paused=${!snap.paused}`)}>
            {snap.paused ? "Продолжить" : "Пауза"}
          </button>
        </div>
      </header>
      <div className="synthetic" role="note" title={note}>
        <span><b>{snap.source.label}.</b> {snap.source.note} Время ускорено в {snap.speed} раз{snap.paused ? ", сейчас на паузе" : ""}.</span>
        {error && <b className="err">Связь с сервером потеряна, показаны последние данные.</b>}
      </div>

      {view !== "twin" && (
        <ScreenGuard key={view} hash={station ? `${view}/${station}` : view} onRetry={() => setAttempt(attempt + 1)}>
          {view === "board" && <Board layout={layout} snap={snap} selected={station} onSelect={setSelected} />}
          {view === "forecast" && <ForecastView layout={layout} snap={snap} onOpen={openStation} />}
          {view === "exec" && <ExecutiveView layout={layout} onOpen={openStation} />}
        </ScreenGuard>
      )}
      {(view === "twin" || twinLive) && (
        <ScreenGuard key={`twin${attempt}`} hidden={view !== "twin"} hash={station ? `twin/${station}` : "twin"}
          onRetry={() => { setTwinLive(false); setAttempt(attempt + 1); }}>
          <Suspense fallback={view === "twin" ? <p className="calm pad-x">Загружаю трёхмерную сцену…</p> : null}>
            <Twin3D layout={layout} snap={snap} selected={station} onSelect={setSelected}
              active={view === "twin"} onReady={() => setTwinLive(true)} />
          </Suspense>
        </ScreenGuard>
      )}
    </div>
  );
}
