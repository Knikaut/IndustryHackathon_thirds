import { useEffect, useId, useRef, useState } from "react";
import { ddmm, hhmm, int, pct, Snapshot, STATE_LABEL, usePoll } from "./api";
import "./scenario.css";

type Stage = "diagnose" | "repair" | "verify" | "done";
interface ScenarioSpec {
  id: string; station: string; title: string; public_title?: string; cause: string; symptom: string;
  diagnosis: string; repair: string; verify: string; crew: string; part: string;
  diagnosis_min: number; repair_min: number; verify_min: number;
  diagnosis_options?: ScenarioOption[]; repair_options?: ScenarioOption[];
}
interface ScenarioOption { id: string; label: string; hint: string; minutes: number }
interface CaseLog { stage: string; at: string; text: string }
interface CrewReport {
  at: string; crew: string; diagnosis: string; action: string; minutes: number; material: string; note: string;
  status: "pending" | "accepted" | "failed" | "returned"; closed_at: string | null;
}
interface Case {
  id: string; station: string; stage: Stage; started: string; finished: string | null;
  downtime_min: number; log: CaseLog[]; feedback?: { kind: "success" | "warning" | "error"; text: string } | null;
  // прежний сервер и макет этих полей не присылают: тогда наряд идёт по старому порядку с проверочным пуском
  report?: CrewReport | null; reports?: CrewReport[];
}
interface ScenarioState { catalog: ScenarioSpec[]; active: Case | null; history: Case[] }
interface PreviewState { stage: Stage; elapsed: number; repairId: string | null; feedback: Case["feedback"]; log: CaseLog[] }

const PREVIEW_TIME = "2026-10-09T10:00";
const PREVIEW_SPEC: ScenarioSpec = {
  id: "paint-filter", station: "P3", title: "Засор фильтра окрасочной камеры", public_title: "Нестабильная подача краски",
  cause: "Замена фильтра", symptom: "Давление в камере колеблется, покрытие получается неравномерным.",
  diagnosis: "Сверить перепад давления.", repair: "Заменить фильтр.", verify: "Нанести тестовый слой и проверить покрытие.",
  crew: "Механик + маляр", part: "Сменный фильтр", diagnosis_min: 10, repair_min: 20, verify_min: 5,
  diagnosis_options: [
    { id: "filter", label: "Засорён фильтр", hint: "Проверить перепад давления до и после фильтра", minutes: 10 },
    { id: "pump", label: "Неисправен насос", hint: "Проверить давление на выходе насоса", minutes: 10 },
  ],
  repair_options: [
    { id: "replace-filter", label: "Заменить фильтр и восстановить давление", hint: "Потребуется сменный фильтр", minutes: 20 },
    { id: "restart-pump", label: "Перезапустить насос", hint: "Без замены фильтрующего элемента", minutes: 10 },
  ],
};
const INITIAL_PREVIEW: PreviewState = {
  stage: "diagnose", elapsed: 5, repairId: null, feedback: null,
  log: [{ stage: "fault", at: PREVIEW_TIME, text: "Остановка P3: нестабильная подача краски" }],
};

const STEPS: { key: "fault" | Stage; label: string }[] = [
  { key: "fault", label: "Отказ" }, { key: "diagnose", label: "Диагностика" },
  { key: "repair", label: "Устранение" }, { key: "verify", label: "Отчёт и пуск" },
];
const LEGACY_VERIFY = "Проверка";
const ORDER: Record<Stage, number> = { diagnose: 1, repair: 2, verify: 3, done: 4 };
const caseMark = (item: Case | null | undefined) => item ? `${item.started}:${item.stage}:${item.log.length}` : "";
const ACTION: Record<Stage, string> = {
  diagnose: "Провести диагностику", repair: "Выполнить ремонт", verify: "Проверочный пуск", done: "Ремонт завершён",
};

function FaultCard({ spec, disabled, current, onStart }: {
  spec: ScenarioSpec; disabled: boolean; current: boolean; onStart: () => void;
}) {
  const interactive = !!spec.diagnosis_options?.length && !!spec.repair_options?.length;
  return (
    <article className={`lab-fault ${current ? "is-current" : ""}`}>
      <div className="lab-fault-top"><span className="lab-code num">{spec.station}</span><span className="lab-fault-kind">{interactive ? "Нужен диагноз" : spec.cause}</span></div>
      <h3>{interactive ? spec.public_title ?? spec.title : spec.title}</h3>
      <p>{spec.symptom}</p>
      <div className="lab-fault-foot">
        <span className="num">{spec.diagnosis_min + spec.repair_min + spec.verify_min} мин работ</span>
        <button type="button" disabled={disabled || current} onClick={onStart}>
          {current ? "Текущий наряд" : "Запустить отказ"} <span aria-hidden="true">↗</span>
        </button>
      </div>
    </article>
  );
}

function ReportReview({ report, minutes, busy, onDecision }: {
  report: CrewReport; minutes: number; busy: boolean; onDecision: (decision: "accept" | "return") => void;
}) {
  // решение доступно после первого открытия; свернуть прочитанный отчёт можно, не теряя этого
  const [read, setRead] = useState(false);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<"accept" | "return" | null>(null);
  const bodyId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  // кнопка, которой применили действие, исчезла вместе с этапом: возвращаем клавиатуре точку опоры
  useEffect(() => { if (document.activeElement === document.body) toggle.current?.focus({ preventScroll: true }); }, []);
  const decide = (decision: "accept" | "return") => { setSent(decision); onDecision(decision); };
  return (
    <>
      <section className={`lab-report ${read ? "" : "unread"}`} aria-label="Отчёт бригады">
        <div className="lab-report-head">
          <span className="lab-report-title">Отчёт · <span className="num">{hhmm(report.at)}</span> · {report.crew}</span>
          <button ref={toggle} type="button" className="lab-report-toggle" aria-expanded={open} aria-controls={bodyId}
            onClick={() => { setOpen(!open); setRead(true); }}>{open ? "Свернуть отчёт" : "Открыть отчёт"}</button>
        </div>
        <div id={bodyId} hidden={!open}>
          <dl className="lab-report-body">
            <div><dt>Подтверждённая причина</dt><dd>{report.diagnosis}</dd></div>
            <div><dt>Действие по наряду</dt><dd>{report.action}</dd></div>
            <div><dt>Израсходовано</dt><dd>{report.material}</dd></div>
            <div><dt>Затрачено</dt><dd className="num">{int(report.minutes)} мин</dd></div>
            <div><dt>Замечание бригады</dt><dd>{report.note}</dd></div>
          </dl>
        </div>
      </section>
      <div className="lab-decisions">
        <button className={`lab-primary ${read ? "" : "locked"}`} type="button" disabled={busy || !read} onClick={() => decide("accept")}>
          {busy && sent === "accept" ? "Выполняется…" : "Принять отчёт и запустить пост"}
          <span className="num">{read ? `+${minutes} мин` : "Сначала откройте отчёт"}</span>
        </button>
        <button className={`lab-secondary ${read ? "" : "locked"}`} type="button" disabled={busy || !read} onClick={() => decide("return")}>
          {busy && sent === "return" ? "Возвращается…" : "Вернуть на доработку"}
        </button>
      </div>
    </>
  );
}

function WorkOrder({ job, spec, busy, preview, selectedOption, onSelectOption, onAdvance, onChoice, onReport }: {
  job: Case | null; spec: ScenarioSpec | undefined; busy: boolean; selectedOption: string;
  preview: boolean;
  onSelectOption: (id: string) => void; onAdvance: () => void; onChoice: (stage: "diagnose" | "repair", optionId: string) => void;
  onReport: (decision: "accept" | "return") => void;
}) {
  if (!job || !spec) return (
    <section className="lab-order lab-order-empty" aria-label="Наряд на ремонт">
      <div className="lab-order-kicker">НАРЯД / НЕ СОЗДАН</div>
      <div className="lab-empty-mark" aria-hidden="true">＋</div>
      <h2>Выберите неисправность</h2>
      <p>Сценарий остановит конкретный пост. В ходе ремонта модельное время, простой и накопители будут меняться вместе с линией.</p>
      <span className="lab-empty-tip">01 / Выберите карточку слева</span>
    </section>
  );

  const step = ORDER[job.stage];
  const done = job.stage === "done";
  const interactive = !!spec.diagnosis_options?.length && !!spec.repair_options?.length;
  const choices = job.stage === "diagnose" ? spec.diagnosis_options : job.stage === "repair" ? spec.repair_options : undefined;
  const choosing = interactive && !!choices?.length && (job.stage === "diagnose" || job.stage === "repair");
  const picked = choices?.find((option) => option.id === selectedOption);
  const withReports = Array.isArray(job.reports);
  const review = job.stage === "verify" && job.report?.status === "pending" ? job.report : null;
  const accepted = done && job.report?.status === "accepted" ? job.report : null;
  const currentText = review ? "Прочитайте отчёт и решите: запускать пост или вернуть работу бригаде. Пост запустится только после принятого отчёта."
    : interactive && job.stage === "diagnose" ? "Сопоставьте симптомы с возможной причиной. Неверный выбор добавит время простоя."
    : interactive && job.stage === "repair" ? withReports
      ? "Выберите действие для подтверждённой неисправности. Бригада выполнит работы и пришлёт отчёт; результат покажет пуск после его принятия."
      : "Выберите действие для подтверждённой неисправности. Результат покажет проверочный пуск."
    : job.stage === "diagnose" ? spec.diagnosis : job.stage === "repair" ? spec.repair : spec.verify;
  const currentMinutes = picked?.minutes ?? (job.stage === "diagnose" ? spec.diagnosis_min : job.stage === "repair" ? spec.repair_min : spec.verify_min);
  return (
    <section className="lab-order" aria-label="Наряд на ремонт">
      <div className="lab-order-head">
        <div><span className="lab-order-kicker">НАРЯД / {job.station}</span><h2>{interactive ? spec.public_title ?? spec.title : spec.title}</h2></div>
        <span className={`lab-state ${done ? "complete" : "active"}`}>{preview ? done ? "Макет завершён" : "Учебный пример" : done ? "Пост возвращён в работу" : "Пост остановлен"}</span>
      </div>
      <ol className="lab-steps" aria-label="Этапы восстановления">
        {STEPS.map((item, index) => <li key={item.key} className={index < step ? "past" : index === step ? "now" : ""}>
          <span className="lab-step-num num">0{index + 1}</span><span>{item.key === "verify" && !withReports ? LEGACY_VERIFY : item.label}</span>
        </li>)}
      </ol>
      <div className="lab-action">
        <span className="lab-overline">{done ? "РЕЗУЛЬТАТ" : `ЭТАП 0${step + 1} / ${job.stage === "diagnose" ? "НАЙТИ ПРИЧИНУ" : job.stage === "repair" ? "УСТРАНИТЬ" : review ? "ПРИНЯТЬ РАБОТУ" : "ПОДТВЕРДИТЬ"}`}</span>
        <h3 aria-live="polite">{done ? "Исправность подтверждена" : review ? "Отчёт бригады поступил" : ACTION[job.stage]}</h3>
        <p>{done ? preview
          ? `Проверочный пуск показан в макете. Условный простой — ${int(job.downtime_min)} мин; реальный двойник не менялся.`
          : `Проверочный пуск пройден. Простой поста составил ${int(job.downtime_min)} мин; событие закрыто в журнале.` : currentText}</p>
        {choosing && <fieldset className="lab-choices" disabled={busy}>
          <legend>{job.stage === "diagnose" ? "Возможные причины" : "Действия ремонтной бригады"}</legend>
          {choices?.map((option) => <label key={option.id} className={selectedOption === option.id ? "picked" : ""}>
            <input type="radio" name={`choice-${job.started}-${job.stage}`} value={option.id}
              checked={selectedOption === option.id} onChange={() => onSelectOption(option.id)} />
            <span className="lab-choice-copy"><strong>{option.label}</strong><small>{option.hint}</small></span>
            <span className="lab-choice-time num">+{option.minutes} мин</span>
          </label>)}
        </fieldset>}
        {accepted && <p className="lab-accepted"><b>Отчёт бригады принят{accepted.closed_at ? <> в <span className="num">{hhmm(accepted.closed_at)}</span></> : ""}.</b> Исполнитель: {accepted.crew}. Действие по наряду: {accepted.action}.</p>}
        {job.feedback && <p className={`lab-feedback ${job.feedback.kind}`} role="status">{job.feedback.text}</p>}
        {review && <ReportReview key={`${job.started}:${job.reports?.length ?? 0}:${review.at}`} report={review}
          minutes={spec.verify_min} busy={busy} onDecision={onReport} />}
        {!done && !review && <button className="lab-primary" type="button" disabled={busy || (choosing && !picked)}
          onClick={() => choosing ? onChoice(job.stage as "diagnose" | "repair", selectedOption) : onAdvance()}>
          {busy ? "Выполняется…" : choosing ? job.stage === "diagnose" ? "Подтвердить диагноз" : "Применить действие" : ACTION[job.stage]}
          <span className="num">{choosing && !picked ? "Выберите вариант" : `+${currentMinutes} мин`}</span>
        </button>}
      </div>
      <div className="lab-resources">
        <div><span>Исполнитель</span><strong>{spec.crew}</strong></div>
        <div><span>Материал</span><strong>{interactive && !done ? "Зависит от действия" : spec.part}</strong></div>
        <div><span>Начало</span><strong className="num">{hhmm(job.started)} · {ddmm(job.started)}</strong></div>
        <div><span>Простой</span><strong className="num">{int(job.downtime_min)} мин</strong></div>
      </div>
      <div className="lab-mechanics">
        <h3>Что меняет двойник</h3>
        <p><b>Отказ.</b> {preview ? "В макете показана остановка поста; реальный выпуск не меняется." : "Пост не выпускает кузова; накопители до и после него продолжают меняться."}</p>
        <p><b>Работы.</b> {preview ? "Время и журнал условные, команды серверу не отправляются." : "Диагностика и устранение добавляют рабочие такты, а журнал считает простой по 5 минут."}</p>
        <p><b>{withReports ? "Отчёт и пуск." : "Проверка."}</b> {preview ? "В макете неудачный пуск возвращает к выбору действия, а удачный завершает пример. Здесь показана только реакция интерфейса."
          : withReports ? "Пост запускается только после того, как диспетчер принял отчёт бригады. Неудачный пуск или возврат отчёта возвращают наряд к выбору действия; удачный закрывает простой и восстанавливает состояние узла до 97 %."
          : interactive ? "Неудачный пуск возвращает наряд к выбору действия. Только удачный закрывает простой и восстанавливает состояние узла до 97 %." : "Пост возвращается в линию, причина закрывается, внутреннее состояние узла восстанавливается до 97 %."}</p>
      </div>
      <div className="lab-log">
        <h3>Ход работ{preview ? " · макет" : ""}</h3>
        <ol>{[...job.log].reverse().map((entry, index) => <li key={`${entry.stage}-${index}`}><time className="num">{hhmm(entry.at)}</time><span>{entry.text}</span></li>)}</ol>
      </div>
    </section>
  );
}

export function ScenarioPage() {
  const previewMode = new URLSearchParams(window.location.search).get("preview") === "choices";
  const { data: lab, error: labError } = usePoll<ScenarioState>("/api/scenarios", 500);
  const { data: snap, error: stateError } = usePoll<Snapshot>("/api/state", 500);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState("");
  const [selection, setSelection] = useState<{ key: string; value: string } | null>(null);
  // отпечаток наряда из ответа команды: пока опрос его не показал, на экране прежний этап и кнопки заблокированы
  const [settling, setSettling] = useState<string | null>(null);
  const sending = useRef(false);
  const [preview, setPreview] = useState<PreviewState>(INITIAL_PREVIEW);
  const [previewStart, setPreviewStart] = useState<string | null>(null);
  useEffect(() => { if (previewMode && snap && !previewStart) setPreviewStart(snap.clock); }, [previewMode, snap, previewStart]);
  const started = previewStart ?? snap?.clock ?? PREVIEW_TIME;
  const catalog = previewMode ? [PREVIEW_SPEC] : lab?.catalog;
  const job: Case | null = previewMode ? {
    id: PREVIEW_SPEC.id, station: PREVIEW_SPEC.station, stage: preview.stage, started,
    finished: preview.stage === "done" ? snap?.clock ?? started : null,
    downtime_min: preview.elapsed, log: preview.log.map((entry) => entry.stage === "fault" ? { ...entry, at: started } : entry),
    feedback: preview.feedback,
  } : lab?.active ?? null;
  const spec = catalog?.find((item) => item.id === job?.id);
  const station = previewMode ? undefined : snap?.stations.find((item) => item.id === job?.station);
  const selectionKey = `${job?.started ?? ""}:${job?.stage ?? ""}`;
  const selectedOption = selection?.key === selectionKey ? selection.value : "";
  const locked = busy || settling !== null;
  useEffect(() => { if (settling !== null && caseMark(lab?.active) === settling) setSettling(null); }, [lab, settling]);
  useEffect(() => {
    if (settling === null) return;
    const timer = window.setTimeout(() => setSettling(null), 3000);
    return () => window.clearTimeout(timer);
  }, [settling]);

  async function command(url: string, body?: { option_id: string }) {
    // два щелчка подряд успевают раньше перерисовки, поэтому повтор отсекает не только состояние
    if (sending.current || locked) return;
    sending.current = true;
    setBusy(true); setActionError("");
    try {
      const response = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.detail || `Ошибка ${response.status}`);
      }
      setSelection(null);
      const next: Case | null = await response.json().catch(() => null);
      if (next?.log) setSettling(caseMark(next));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Команда не выполнена");
    } finally { sending.current = false; setBusy(false); }
  }

  function choose(stage: "diagnose" | "repair", optionId: string) {
    if (!previewMode) return command(`/api/scenarios/${stage}`, { option_id: optionId });
    setSelection(null);
    const at = snap?.clock ?? PREVIEW_TIME;
    setPreview((current) => {
      if (stage === "diagnose") {
        const correct = optionId === "filter";
        return { ...current, stage: correct ? "repair" : "diagnose", elapsed: current.elapsed + 10,
          feedback: { kind: correct ? "success" : "warning", text: correct
            ? "Перепад давления подтвердил засор фильтра." : "Сигналы насоса в норме. Причина простоя ещё не найдена." },
          log: [...current.log, { stage, at, text: correct ? "Подтверждён засор фильтра" : "Проверен насос — неисправность не найдена" }] };
      }
      return { ...current, stage: "verify", elapsed: current.elapsed + (optionId === "replace-filter" ? 20 : 10),
        repairId: optionId, feedback: null,
        log: [...current.log, { stage, at, text: optionId === "replace-filter" ? "Фильтр заменён" : "Насос перезапущен" }] };
    });
  }

  function advance() {
    if (!previewMode) return command(spec?.diagnosis_options?.length && spec?.repair_options?.length
      ? "/api/scenarios/verify" : "/api/scenarios/advance");
    const at = snap?.clock ?? PREVIEW_TIME;
    setPreview((current) => {
      if (current.stage !== "verify") return current;
      const passed = current.repairId === "replace-filter";
      return { ...current, stage: passed ? "done" : "repair", elapsed: current.elapsed + 5,
        feedback: { kind: passed ? "success" : "error", text: passed
          ? "Тестовый слой ровный. Пост можно запускать." : "Давление всё ещё нестабильно: фильтр остаётся засорённым." },
        log: [...current.log, { stage: "verify", at, text: passed ? "Проверочный пуск пройден" : "Проверочный пуск не пройден" }] };
    });
  }

  return (
    <div className="lab-page">
      <header className="lab-header">
        <div className="lab-brand"><span className="lab-brand-mark">A<span>·</span></span><span>ALLUR / ЦИФРОВОЙ ДВОЙНИК</span></div>
        <div className="lab-header-right"><span className="lab-private">ОТДЕЛЬНЫЙ ДЕМО-ЭКРАН</span><a href="/">Вернуться к щиту <span aria-hidden="true">↗</span></a></div>
      </header>

      <main className="lab-main">
        {previewMode && <div className="lab-preview-banner" role="note"><b>ПРЕДПРОСМОТР НОВОГО UI</b><span>Выборы работают только на этой странице и не меняют двойник.</span></div>}
        <section className="lab-intro">
          <div><p className="lab-overline">ПРАКТИКУМ / ОТКАЗЫ И ВОССТАНОВЛЕНИЕ</p><h1>Лаборатория<br /><em>неисправностей.</em></h1></div>
          <div className="lab-intro-copy"><strong>От сигнала до запуска линии.</strong><p>{previewMode
            ? "Посмотрите, как будет выглядеть выбор диагноза и ремонта. Этот предпросмотр не меняет показатели двойника."
            : "Выберите отказ, пройдите диагностику, устранение и контроль. Каждый этап продвигает время двойника и влияет на те же показатели, что видны на основном щите."}</p></div>
        </section>

        <section className="lab-telemetry" aria-label="Состояние линии">
          <div><span>Время модели</span><strong className="num">{snap ? `${hhmm(snap.clock)} · ${ddmm(snap.clock)}` : "—"}</strong></div>
          <div><span>Постов в простое</span><strong className="num">{snap ? snap.stations.filter((item) => item.state === "down").length : "—"}<small> / {snap?.stations.length ?? "—"}</small></strong></div>
          <div><span>OEE смены</span><strong className="num">{snap ? pct(snap.kpi.oee, 0) : "—"}<small> %</small></strong></div>
          <div><span>Выпуск / план</span><strong className="num">{snap ? `${int(snap.kpi.fact)} / ${int(snap.kpi.plan)}` : "—"}<small> шт</small></strong></div>
          <div className="lab-telemetry-status"><i className={station?.state === "down" ? "red" : ""} /><span>{previewMode ? "Макет выбора" : station ? `${station.id} · ${STATE_LABEL[station.state]}` : snap?.paused ? "Модель на паузе" : "Линия в работе"}</span></div>
        </section>

        {(labError || stateError || actionError) && <p className="lab-error" role="alert">{actionError || `Нет связи с сервером: ${labError || stateError}`}</p>}
        <div className="lab-grid">
          <section className="lab-catalog" aria-labelledby="lab-catalog-title">
            <div className="lab-section-head"><div><span className="lab-overline">01 / СЦЕНАРИИ</span><h2 id="lab-catalog-title">Выберите отказ</h2></div><span className="lab-counter num">{catalog?.length ?? "—"} {previewMode ? "макет" : "случая"}</span></div>
            <div className="lab-cards">
              {catalog?.map((item) => <FaultCard key={item.id} spec={item}
                disabled={locked || (!!job && job.stage !== "done")}
                current={job?.id === item.id && job.stage !== "done"}
                onStart={() => {
                  if (previewMode) { setPreview(INITIAL_PREVIEW); setSelection(null); }
                  else command(`/api/scenarios/${item.id}/start`);
                }} />)}
            </div>
            <p className="lab-caption">{previewMode ? "В предпросмотре время и последствия показаны условно; реальные показатели линии не меняются." : "Длительности работ условные. Пока двойник работает, простой продолжает расти и между действиями. Это не заводской регламент."}</p>
          </section>
          <div className="lab-work">
            <div className="lab-section-head"><div><span className="lab-overline">02 / ВОССТАНОВЛЕНИЕ</span><h2>Разбор и ремонт</h2></div><span className="lab-live"><i /> {previewMode ? "UI / МАКЕТ" : "LIVE / 5 МИН ТАКТ"}</span></div>
            <WorkOrder job={job} spec={spec} busy={locked} preview={previewMode} selectedOption={selectedOption}
              onSelectOption={(value) => setSelection({ key: selectionKey, value })}
              onAdvance={advance} onChoice={choose} onReport={(decision) => command(`/api/scenarios/report/${decision}`)} />
          </div>
        </div>
      </main>
    </div>
  );
}
