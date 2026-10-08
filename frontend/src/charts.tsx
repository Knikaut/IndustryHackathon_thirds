import { useLayoutEffect, useRef, useState } from "react";

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    const ro = new ResizeObserver(read);
    ro.observe(el);
    read();
    return () => ro.disconnect();
  }, []);
  return [ref, size.w, size.h] as const;
}

type V = number | null;
export interface LineSeries { values: V[]; color: string; width?: number; dashed?: boolean; label?: string }

function niceTicks(lo: number, hi: number, n = 3) {
  const span = hi - lo || 1;
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(+v.toFixed(6));
  return out;
}

interface Scale { lo: number; hi: number; step: number }

/** «Круглые» границы шкалы: не больше n делений с шагом 1, 2, 2,5 или 5 × 10^k, края стоят на делениях. */
function niceBounds(lo: number, hi: number, n: number): Scale {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (hi <= lo) hi = lo + (Math.abs(lo) || 1) * 0.1;
  for (let mag = 10 ** Math.floor(Math.log10((hi - lo) / n)); ; mag *= 10) {
    for (const m of [1, 2, 2.5, 5]) {
      const step = m * mag;
      const a = Math.floor(lo / step + 1e-9), b = Math.ceil(hi / step - 1e-9);
      if (b - a <= n) return { lo: +(a * step).toFixed(6), hi: +(b * step).toFixed(6), step };
    }
  }
}

// столько обновлений данных подряд ряд должен умещаться в заметно меньшую шкалу, чтобы она сузилась
const CALM = 30;

/**
 * Шкала с гистерезисом: расширяется сразу до круглых границ, сужается только после долгого затишья.
 * Между этими событиями деления стоят на месте, как бы ни шумели данные.
 */
function useScale(lo: number, hi: number, n: number, points: number, sig: string): Scale {
  const ref = useRef<{ s: Scale; sig: string; points: number; n: number; calm: number } | null>(null);
  const want = niceBounds(lo, hi, n);
  const cur = ref.current;
  // другой набор данных (например, сменили период) или другая высота: шкала строится заново
  if (!cur || cur.n !== n || Math.abs(points - cur.points) > cur.points / 4) {
    ref.current = { s: want, sig, points, n, calm: 0 };
    return want;
  }
  if (cur.sig === sig) return cur.s;
  cur.sig = sig;
  cur.points = points;
  const eps = cur.s.step * 1e-6;
  if (lo < cur.s.lo - eps || hi > cur.s.hi + eps) {
    cur.s = niceBounds(Math.min(lo, cur.s.lo), Math.max(hi, cur.s.hi), n);
    cur.calm = 0;
  } else if (want.hi - want.lo <= 0.6 * (cur.s.hi - cur.s.lo)) {
    if (++cur.calm >= CALM) { cur.s = want; cur.calm = 0; }
  } else cur.calm = 0;
  return cur.s;
}

function scaleTicks(s: Scale) {
  const out: number[] = [];
  for (let v = Math.ceil(s.lo / s.step - 1e-9) * s.step; v <= s.hi + s.step * 1e-6; v += s.step) out.push(+v.toFixed(6));
  return out;
}

/**
 * Линейный график: общая ось, опорная линия (норма или порог), подписи по краям оси X.
 * Если min или max не заданы, шкала подбирается по данным и держится (см. useScale);
 * floor — диапазон, который шкала показывает всегда, чтобы шум датчика не растягивался на всю высоту.
 * fit — высоту задаёт контейнер (CSS), а не число.
 */
export function LineChart({
  series, height = 120, min, max, refLine, xLabels, fmt = (v: number) => String(v), area, floor, fit,
}: {
  series: LineSeries[]; height?: number; min?: number; max?: number;
  refLine?: { value: number; label: string; color?: string };
  xLabels?: string[]; fmt?: (v: number) => string; area?: boolean;
  floor?: [number, number]; fit?: boolean;
}) {
  const [ref, w, boxH] = useSize<HTMLDivElement>();
  const H = fit ? boxH || height : height;
  // на совсем низком графике подписи времени уступают место самой линии
  const labels = xLabels && H >= 56 ? xLabels : undefined;
  const padL = 34, padR = 6, padT = 8, padB = labels ? 18 : 6;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (refLine) all.push(refLine.value);
  if (floor) all.push(...floor);
  const dLo = min ?? (all.length ? Math.min(...all) : 0), dHi = max ?? (all.length ? Math.max(...all) : 1);
  const n = Math.max(...series.map((s) => s.values.length), 2);
  const rows = H < 90 ? 2 : 3;
  const first = series[0]?.values;
  const auto = useScale(dLo, dHi, rows, n, `${rows}|${dLo}|${dHi}|${first?.[0]}|${first?.[first.length - 1]}`);
  const fixed = min != null && max != null;
  let lo = min ?? auto.lo, hi = max ?? auto.hi;
  if (hi <= lo) hi = lo + 1;
  const ticks = fixed ? niceTicks(lo, hi) : scaleTicks({ lo, hi, step: auto.step });
  const X = (i: number) => padL + (i / (n - 1)) * (w - padL - padR);
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const path = (vals: V[]) => {
    let d = "", pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      // одиночная точка между пропусками: нулевой штрих, круглый конец линии делает из него точку
      if (!pen && vals[i + 1] == null) d += "h0.01";
      pen = true;
    });
    return d;
  };
  // заливка под линией: каждый непрерывный участок замыкается на ось отдельно, пропуски остаются пустыми
  const fill = (vals: V[]) => {
    let d = "", from = -1;
    const close = (to: number) => { d += `L${X(to).toFixed(1)},${H - padB}L${X(from).toFixed(1)},${H - padB}Z`; from = -1; };
    vals.forEach((v, i) => {
      if (v == null) { if (from >= 0) close(i - 1); return; }
      d += `${from < 0 ? "M" : "L"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      if (from < 0) from = i;
    });
    if (from >= 0) close(vals.length - 1);
    return d;
  };
  return (
    <div ref={ref} className={fit ? "chart fit" : "chart"} style={fit ? undefined : { height }}>
      {w > 0 && H > 0 && (
        <svg width={w} height={H} role="img">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} className="grid" />
              <text x={padL - 6} y={Y(t) + 3.5} textAnchor="end" className="tick">{fmt(t)}</text>
            </g>
          ))}
          {refLine && (
            <g>
              <line x1={padL} x2={w - padR} y1={Y(refLine.value)} y2={Y(refLine.value)}
                stroke={refLine.color ?? "var(--ink-3)"} strokeDasharray="4 4" strokeWidth="1" />
              <text x={padL + 4} y={Y(refLine.value) - 4} textAnchor="start" className="tick ref">{refLine.label}</text>
            </g>
          )}
          {series.map((s, i) => (
            <g key={i}>
              {area && i === 0 && <path d={fill(s.values)} fill={s.color} opacity="0.12" />}
              <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.75}
                strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {labels?.map((l, i) => (
            <text key={i} x={padL + (i / (labels.length - 1)) * (w - padL - padR)} y={H - 4}
              textAnchor={i === 0 ? "start" : i === labels.length - 1 ? "end" : "middle"} className="tick">{l}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

/** Столбцы факта с отметкой плана над каждым. */
export function PlanFact({
  items, height = 120, fit,
}: { items: { label: string; fact: number; plan: number }[]; height?: number; fit?: boolean }) {
  const [ref, w, boxH] = useSize<HTMLDivElement>();
  const H = fit ? boxH || height : height;
  const padL = 34, padB = 18, padT = 8;
  const top = Math.max(1, ...items.flatMap((i) => [i.fact, i.plan]));
  const scale = useScale(0, top, H < 90 ? 2 : 3, items.length, `${H < 90}|${top}`);
  const hi = scale.hi;
  const slot = (w - padL) / Math.max(1, items.length);
  const bw = Math.max(3, Math.min(26, slot * 0.62));
  const Y = (v: number) => padT + (1 - v / hi) * (H - padT - padB);
  const every = Math.ceil(items.length / Math.max(1, Math.floor((w - padL) / 46)));
  return (
    <div ref={ref} className={fit ? "chart fit" : "chart"} style={fit ? undefined : { height }}>
      {w > 0 && H > 0 && (
        <svg width={w} height={H} role="img">
          {scaleTicks(scale).map((t) => (
            <g key={t}>
              <line x1={padL} x2={w} y1={Y(t)} y2={Y(t)} className="grid" />
              <text x={padL - 6} y={Y(t) + 3.5} textAnchor="end" className="tick">{t}</text>
            </g>
          ))}
          {items.map((it, i) => {
            const cx = padL + slot * (i + 0.5);
            const short = it.plan > 0 && it.fact < it.plan * 0.95;
            return (
              <g key={i}>
                <rect x={cx - bw / 2} y={Y(it.fact)} width={bw} height={Math.max(0, H - padB - Y(it.fact))}
                  fill={short ? "var(--warn-ink)" : "var(--ink)"} />
                {it.plan > 0 && (
                  <line x1={cx - bw / 2 - 2} x2={cx + bw / 2 + 2} y1={Y(it.plan)} y2={Y(it.plan)}
                    stroke="var(--plan)" strokeWidth="2" />
                )}
                {i % every === 0 && <text x={cx} y={H - 4} textAnchor="middle" className="tick">{it.label}</text>}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

/** Горизонтальные полосы с подписью и значением. */
export function Bars({
  items, color = "var(--ink)",
}: { items: { label: string; value: number; text: string }[]; color?: string }) {
  const hi = Math.max(1, ...items.map((i) => i.value));
  let acc = 0;
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <ul className="bars">
      {items.map((it) => {
        acc += it.value;
        return (
          <li key={it.label}>
            <span className="bars-label">{it.label}</span>
            <span className="bars-track"><i style={{ transform: `scaleX(${it.value / hi})`, background: color }} /></span>
            <span className="bars-val num">{it.text}</span>
            <span className="bars-cum num">{Math.round((acc / total) * 100)} %</span>
          </li>
        );
      })}
    </ul>
  );
}
