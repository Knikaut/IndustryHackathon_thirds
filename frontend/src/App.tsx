import { lazy, Suspense, useState } from "react";
import { hhmm, ddmm, Layout, post, Snapshot, usePoll } from "./api";
import { Board } from "./Board";
import { ExecutiveView } from "./Executive";
import { ForecastView } from "./Forecast";

const Twin3D = lazy(() => import("./Twin3D"));

type View = "board" | "twin" | "forecast" | "exec";
const VIEWS: [View, string][] = [["board", "Щит"], ["twin", "Завод 3D"], ["forecast", "Прогноз"], ["exec", "Руководителю"]];

export function App() {
  // прямая ссылка на экран и пост: #twin, #twin/W3, #forecast
  const [hashView, hashStation] = window.location.hash.slice(1).split("@")[0].split("/");
  const [view, setView] = useState<View>(VIEWS.some(([id]) => id === hashView) ? (hashView as View) : "board");
  const [selected, setSelected] = useState<string | null>(hashStation || null);
  const { data: layout, error: layoutErr } = usePoll<Layout>("/api/layout", 0);
  const { data: snap, error } = usePoll<Snapshot>("/api/state", 1000);

  if (!layout || !snap) {
    return (
      <div className="boot">
        <h1>Двойник завода</h1>
        <p>{error || layoutErr
          ? "Сервер данных не отвечает. Запустите бэкенд: uvicorn app.main:app --port 8000"
          : "Собираю историю и обучаю модель прогноза…"}</p>
      </div>
    );
  }

  const openStation = (id: string) => { setSelected(id); setView("board"); };
  const openCount = snap.incidents.filter((i) => i.open).length;

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
              onClick={() => setView(id)}>
              {label}
              {id === "board" && openCount > 0 && <b className="count">{openCount}</b>}
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
          <button className="ghost" title={snap.source.note}
            onClick={() => post(`/api/demo/speed?tick_seconds=${snap.tick_seconds}&paused=${!snap.paused}`)}>
            {snap.paused ? "Продолжить" : "Пауза"}
          </button>
        </div>
      </header>
      <div className="synthetic" role="note">
        <b>{snap.source.label}.</b> {snap.source.note} Время ускорено в {snap.speed} раз{snap.paused ? ", сейчас на паузе" : ""}.
        {error && <b className="err"> Связь с сервером потеряна, показаны последние данные.</b>}
      </div>

      {view === "board" && <Board layout={layout} snap={snap} selected={selected} onSelect={setSelected} />}
      {view === "twin" && (
        <Suspense fallback={<p className="calm pad-x">Загружаю трёхмерную сцену…</p>}>
          <Twin3D layout={layout} snap={snap} selected={selected} onSelect={setSelected} />
        </Suspense>
      )}
      {view === "forecast" && <ForecastView layout={layout} snap={snap} onOpen={openStation} />}
      {view === "exec" && <ExecutiveView layout={layout} onOpen={openStation} />}
    </div>
  );
}
