import { useEffect, useRef, useState } from "react";

export type StateName = "run" | "starved" | "blocked" | "down" | "planned" | "off";

export interface StationSpec {
  id: string; shop: string; name: string; asset: string; kind: string; cycle_s: number; x: number; y: number;
  site?: [number, number]; rig?: string; op?: string;
}
export interface BufferSpec { id: string; after: string; name: string; cap: number; x: number; y: number; site?: [number, number] }
export interface Shop { id: string; name: string; full: string }
export interface Layout {
  shops: Shop[]; stations: StationSpec[]; buffers: BufferSpec[]; path: [number, number][]; path3d?: [number, number][];
  canvas: { w: number; h: number }; nominal_per_hour: number; plan_per_hour: number;
}
export interface StationLive {
  id: string; state: StateName; cause: string | null; down_min: number; units_h: number;
  risk: number; risk_level: "low" | "elevated" | "high";
  vib: number | null; temp: number | null; cur: number | null; cyc: number | null;
  load: number; oee: number; fpy: number; units: number; defects: number; downtime_min: number; downtime_day_min: number;
}
export interface Targets { oee: number; defect: number; downtime_min: number; month_plan: number }
export interface Factor { key: string; label: string; value: string; weight: number }
export interface Incident {
  id: string; type: "downtime" | "forecast" | "quality" | "plan" | "buffer" | "bottleneck" | "limit";
  station: string; shop: string | null; severity: "critical" | "warning";
  title: string; detail: string; action: string | null; start: string; end: string | null;
  open: boolean; outcome: string | null;
}
export interface BufferLive {
  id: string; name: string; after: string; cap: number; level: number;
  direction: "stable" | "filling" | "draining"; eta_min: number | null; per_hour: number; history: number[];
}
export interface Kpi {
  plan: number; fact: number; ideal: number; oee: number; availability: number; performance: number;
  quality: number; load: number; downtime_min: number; defects: number; sched_hours: number;
}
export interface ForecastItem {
  station: string; name: string; asset: string; shop: string; risk: number;
  factors: Factor[]; action: string; history: (number | null)[];
}
export interface Snapshot {
  clock: string; tick_seconds: number; paused: boolean; speed: number;
  source: { kind: string; label: string; note: string };
  shift: { name: string; start: string; end: string; progress: number; plan_total: number };
  kpi: Kpi; hourly: { hour: string; fact: number; plan: number }[];
  stations: StationLive[]; buffers: BufferLive[]; incidents: Incident[]; forecast: ForecastItem[];
  bottleneck: { station: string; name: string; shop: string; reason: string; window_min: number } | null;
  horizon_h: number; threshold: number; targets: Targets;
}
export interface StationDetail {
  id: string; name: string; asset: string; shop: string; shop_name: string; cycle_s: number; op?: string;
  base: { vib: number; temp: number; cur: number; cyc: number };
  series: { t: string; vib: number | null; temp: number | null; cur: number | null; cyc: number | null; state: StateName; risk: number | null }[];
  events: { start: string; end: string | null; cause: string; minutes: number }[];
  factors: Factor[]; action: string; hours_since_repair: number;
}
export interface Executive {
  days: number; total: Kpi;
  daily: { date: string; plan: number; fact: number; oee: number; availability: number; performance: number; quality: number; downtime_min: number }[];
  pareto: { cause: string; minutes: number }[];
  shops: { id: string; name: string; downtime_min: number; failures: number; oee: number; fpy: number; defect_rate: number; defects: number }[];
  stations: { id: string; name: string; shop: string; downtime_min: number; failures: number; mtbf_h: number | null; mttr_min: number | null; oee: number; fpy: number; defects: number; load: number }[];
  equip_downtime_h: number; units_per_hour: number; shortfall: number; targets: Targets;
  month: {
    plan: number; fact: number; projected: number; per_hour: number; hours_worked: number; hours_total: number;
    work_days: number; shift_plan_total: number; models: { model: string; plan: number; fact: number }[];
  };
  model: {
    roc_auc: number; precision: number; recall: number; event_recall: number; lead_h: number | null;
    test_failures: number; caught_failures: number; failures_total: number; train_rows: number;
    horizon_h: number; horizon_unit?: string; threshold: number; algorithm: string; features: string[];
  };
}

/** Тестовые данные организаторов и их сверка с нормативами. */
export interface OrgData {
  file?: string;
  lines?: { date: string; line: string; plan: number; fact: number; hours: number; load: number; done: number; defect: number | null; oee: number }[];
  downtime?: { date: string; shop: string; equipment: string; cause: string; minutes: number }[];
  models?: { model: string; plan: number }[];
  quality?: { date: string; shop: string; made: number; defects: number; rate: number }[];
  checks?: { ok: boolean; title: string; text: string }[];
  assumptions?: string[];
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// растёт после каждой команды двойнику: следующий ответ опроса принимается, даже если такт тот же
let commands = 0;
export const post = (url: string) => fetch(url, { method: "POST" }).finally(() => { commands++; });

// последние ответы по адресу: повторный вход на экран сразу показывает прежние данные
const cache = new Map<string, unknown>();

export interface PollOptions<T> {
  /** Если вернёт true, ответ считается тем же снимком: состояние не меняется и экран не перерисовывается. */
  same?: (prev: T, next: T) => boolean;
  /** Перезапросить при смене значения (например, такта модели) вместо собственного таймера. */
  tick?: unknown;
}

/**
 * Опрос API с интервалом. Старые данные остаются на экране, пока грузятся новые.
 * При ms = 0 запрос разовый, но после ошибки повторяется, пока сервер не ответит.
 */
export function usePoll<T>(url: string | null, ms: number, opts: PollOptions<T> = {}) {
  const [data, setData] = useState<T | null>(() => (url ? (cache.get(url) as T | undefined) ?? null : null));
  const [error, setError] = useState<string | null>(null);
  const same = useRef(opts.same);
  same.current = opts.same;
  const kick = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!url) return;
    let alive = true, busy = false, again = false, fails = 0, timer = 0;
    // данные и номер команды, при которых принят последний ответ по этому адресу
    let shown = cache.get(url) as T | undefined, stamp = -1;
    if (shown !== undefined) setData(shown);
    const load = () => {
      const sent = commands;
      busy = true;
      get<T>(url)
        .then((d) => {
          if (!alive) return;
          fails = 0;
          cache.set(url, d);
          setError(null);
          if (shown !== undefined && sent === stamp && same.current?.(shown, d)) return;
          shown = d; stamp = sent;
          setData(d);
        })
        .catch((e) => { if (alive) { fails++; setError(String(e.message ?? e)); } })
        .finally(() => {
          if (!alive) return;
          busy = false;
          if (again) { again = false; load(); }
          else if (ms > 0) timer = window.setTimeout(load, ms);
          else if (fails) timer = window.setTimeout(load, Math.min(10000, 2000 * fails));
        });
    };
    // запрос по такту: если предыдущий ещё в пути, новый уйдёт сразу после него, а не поверх
    kick.current = () => { if (busy) again = true; else { clearTimeout(timer); load(); } };
    load();
    return () => { alive = false; kick.current = null; clearTimeout(timer); };
  }, [url, ms]);
  const tick = useRef(opts.tick);
  useEffect(() => {
    if (Object.is(tick.current, opts.tick)) return;
    tick.current = opts.tick;
    kick.current?.();
  }, [opts.tick]);
  return { data, error };
}

// --- формат ---------------------------------------------------------------
const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const int = (x: number | null | undefined) => (x == null ? "—" : nf0.format(x));
export const dec = (x: number | null | undefined) => (x == null ? "—" : nf1.format(x));
export const pct = (x: number | null | undefined, d = 1) =>
  x == null ? "—" : (d ? nf1 : nf0).format(x * 100);
export const hhmm = (iso: string) => iso.slice(11, 16);
export const ddmm = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
export function dur(min: number) {
  if (min < 60) return `${Math.round(min)} мин`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h} ч ${m} мин` : `${h} ч`;
}

export const STATE_LABEL: Record<StateName, string> = {
  run: "Работает", starved: "Ждёт подачи", blocked: "Затор впереди", down: "Простой", planned: "Плановое ТО", off: "Вне смены",
};
