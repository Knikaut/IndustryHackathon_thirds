import { useLayoutEffect, useRef, useState } from "react";

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
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

/** Линейный график: общая ось, опорная линия (норма или порог), подписи по краям оси X. */
export function LineChart({
  series, height = 120, min, max, refLine, xLabels, fmt = (v: number) => String(v), area,
}: {
  series: LineSeries[]; height?: number; min?: number; max?: number;
  refLine?: { value: number; label: string; color?: string };
  xLabels?: string[]; fmt?: (v: number) => string; area?: boolean;
}) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const padL = 34, padR = 6, padT = 8, padB = xLabels ? 18 : 6;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  if (refLine) all.push(refLine.value);
  let lo = min ?? Math.min(...all), hi = max ?? Math.max(...all);
  if (!all.length) { lo = 0; hi = 1; }
  if (min == null) lo -= (hi - lo) * 0.08;
  if (max == null) hi += (hi - lo) * 0.08;
  if (hi === lo) hi = lo + 1;
  const n = Math.max(...series.map((s) => s.values.length), 2);
  const X = (i: number) => padL + (i / (n - 1)) * (w - padL - padR);
  const Y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (height - padT - padB);
  const path = (vals: V[]) => {
    let d = "", pen = false;
    vals.forEach((v, i) => {
      if (v == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };
  return (
    <div ref={ref} className="chart">
      {w > 0 && (
        <svg width={w} height={height} role="img">
          {niceTicks(lo, hi).map((t) => (
            <g key={t}>
              <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} className="grid" />
              <text x={padL - 6} y={Y(t) + 3.5} textAnchor="end" className="tick">{fmt(t)}</text>
            </g>
          ))}
          {refLine && (
            <g>
              <line x1={padL} x2={w - padR} y1={Y(refLine.value)} y2={Y(refLine.value)}
                stroke={refLine.color ?? "var(--ink-3)"} strokeDasharray="4 4" strokeWidth="1" />
              <text x={padL + 4} y={Y(refLine.value) - 4} textAnchor="start" className="tick">{refLine.label}</text>
            </g>
          )}
          {series.map((s, i) => (
            <g key={i}>
              {area && i === 0 && (
                <path d={`${path(s.values)}L${X(s.values.length - 1)},${height - padB}L${X(0)},${height - padB}Z`}
                  fill={s.color} opacity="0.12" />
              )}
              <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={s.width ?? 1.75}
                strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {xLabels?.map((l, i) => (
            <text key={i} x={padL + (i / (xLabels.length - 1)) * (w - padL - padR)} y={height - 4}
              textAnchor={i === 0 ? "start" : i === xLabels.length - 1 ? "end" : "middle"} className="tick">{l}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

/** Столбцы факта с отметкой плана над каждым. */
export function PlanFact({
  items, height = 120,
}: { items: { label: string; fact: number; plan: number }[]; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  const padL = 34, padB = 18, padT = 8;
  const hi = Math.max(1, ...items.flatMap((i) => [i.fact, i.plan])) * 1.08;
  const slot = (w - padL) / Math.max(1, items.length);
  const bw = Math.max(3, Math.min(26, slot * 0.62));
  const Y = (v: number) => padT + (1 - v / hi) * (height - padT - padB);
  const every = Math.ceil(items.length / Math.max(1, Math.floor((w - padL) / 46)));
  return (
    <div ref={ref} className="chart">
      {w > 0 && (
        <svg width={w} height={height} role="img">
          {niceTicks(0, hi).map((t) => (
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
                <rect x={cx - bw / 2} y={Y(it.fact)} width={bw} height={Math.max(0, height - padB - Y(it.fact))}
                  fill={short ? "var(--warn-ink)" : "var(--ink)"} />
                {it.plan > 0 && (
                  <line x1={cx - bw / 2 - 2} x2={cx + bw / 2 + 2} y1={Y(it.plan)} y2={Y(it.plan)}
                    stroke="var(--plan)" strokeWidth="2" />
                )}
                {i % every === 0 && <text x={cx} y={height - 4} textAnchor="middle" className="tick">{it.label}</text>}
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
