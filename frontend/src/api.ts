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
    horizon_h: number; threshold: number; algorithm: string; features: string[];
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

export const post = (url: string) => fetch(url, { method: "POST" });

/** Опрос API с интервалом. Старые данные остаются на экране, пока грузятся новые. */
export function usePoll<T>(url: string | null, ms: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    if (!url) return;
    const mine = ++seq.current;
    let timer: number;
    const load = () =>
      get<T>(url)
        .then((d) => { if (mine === seq.current) { setData(d); setError(null); } })
        .catch((e) => { if (mine === seq.current) setError(String(e.message ?? e)); })
        .finally(() => { if (mine === seq.current && ms > 0) timer = window.setTimeout(load, ms); });
    load();
    return () => { seq.current++; clearTimeout(timer); };
  }, [url, ms]);
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
