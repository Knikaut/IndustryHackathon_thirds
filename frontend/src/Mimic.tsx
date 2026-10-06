import { useMemo } from "react";
import { dur, int, Layout, Snapshot, STATE_LABEL } from "./api";

type P = [number, number];

/** Срезает углы ломаной фасками под 45°. */
export function chamfer(pts: P[], r: number): P[] {
  const out: P[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const [a, b, c] = [pts[i - 1], pts[i], pts[i + 1]];
    const u = (p: P, q: P): P => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      return [(q[0] - p[0]) / d, (q[1] - p[1]) / d];
    };
    const [d1, d2] = [u(b, a), u(b, c)];
    out.push([b[0] + d1[0] * r, b[1] + d1[1] * r], [b[0] + d2[0] * r, b[1] + d2[1] * r]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function geometry(pts: P[]) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const distOf = ([x, y]: P) => {
    let best = 0, bestErr = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      const len = cum[i] - cum[i - 1];
      const t = Math.max(0, Math.min(1, ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (len * len)));
      const err = Math.hypot(a[0] + (b[0] - a[0]) * t - x, a[1] + (b[1] - a[1]) * t - y);
      if (err < bestErr) { bestErr = err; best = cum[i - 1] + t * len; }
    }
    return best;
  };
  const at = (d: number): P => {
    let i = 1;
    while (i < pts.length - 1 && cum[i] < d) i++;
    const t = (d - cum[i - 1]) / (cum[i] - cum[i - 1]);
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  };
  const slice = (d0: number, d1: number) => {
    const out: P[] = [at(d0)];
    for (let i = 1; i < pts.length - 1; i++) if (cum[i] > d0 && cum[i] < d1) out.push(pts[i]);
    out.push(at(d1));
    return "M" + out.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join("L");
  };
  return { total: cum[cum.length - 1], distOf, slice, at };
}

export function Mimic({
  layout, snap, selected, onSelect,
}: { layout: Layout; snap: Snapshot; selected: string | null; onSelect: (id: string | null) => void }) {
  const geo = useMemo(() => {
    const g = geometry(chamfer(layout.path as P[], 36));
    const d = layout.stations.map((s) => g.distOf([s.x, s.y]));
    return { ...g, d };
  }, [layout]);
  const live = Object.fromEntries(snap.stations.map((s) => [s.id, s]));
  const bn = snap.bottleneck?.station;

  const zones = layout.shops.map((shop) => {
    const ss = layout.stations.filter((s) => s.shop === shop.id);
    const xs = ss.map((s) => s.x);
    return { shop, x0: Math.min(...xs) - 64, x1: Math.max(...xs) + 64, y: ss[0].y };
  });

  return (
    <div className="mimic-scroll">
      <svg className="mimic" viewBox={`0 0 ${layout.canvas.w} ${layout.canvas.h}`}
        role="group" aria-label="Мнемосхема завода">
        <defs>
          <pattern id="tiles" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="var(--tile)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#tiles)" onClick={() => onSelect(null)} />

        {zones.map(({ shop, x0, x1, y }) => (
          <g key={shop.id} className="zone">
            <path d={`M${x0},${y - 80}v-8H${x1}v8`} />
            <text x={(x0 + x1) / 2} y={y - 100} textAnchor="middle">{x1 - x0 < 200 ? shop.name : shop.full}</text>
          </g>
        ))}

        <path d={geo.slice(0, geo.total)} className="pipe" />
        {layout.stations.map((s, i) => {
          const from = i === 0 ? 0 : geo.d[i - 1];
          const feeding = i === 0 ? live[s.id].state === "run" : live[layout.stations[i - 1].id].state === "run";
          return feeding ? <path key={s.id} d={geo.slice(from, geo.d[i])} className="flow" /> : null;
        })}
        {live[layout.stations[layout.stations.length - 1].id].state === "run" && (
          <path d={geo.slice(geo.d[geo.d.length - 1], geo.total)} className="flow" />
        )}
        <text x={layout.path[0][0]} y={layout.path[0][1] - 16} className="terminal">ПОСТАВЩИКИ</text>
        <text x={layout.canvas.w - 40} y={layout.path[layout.path.length - 1][1] - 16} textAnchor="end" className="terminal">ДИЛЕРАМ</text>

        {snap.buffers.map((b) => {
          const spec = layout.buffers.find((x) => x.id === b.id)!;
          const cells = 10, filled = Math.round((b.level / b.cap) * cells);
          const tone = b.level / b.cap >= 0.9 || b.level / b.cap <= 0.1 ? "warn" : "";
          return (
            <g key={b.id} className={`tank ${tone}`} transform={`translate(${spec.x - 55},${spec.y - 17})`}>
              <rect width="110" height="34" className="tank-body" />
              {Array.from({ length: cells }, (_, k) => (
                <rect key={k} x={4 + k * 10.3} y="4" width="8.3" height="26" className={k < filled ? "cell on" : "cell"} />
              ))}
              <text x="55" y="-12" textAnchor="middle" className="tank-name">{b.name.toUpperCase()}</text>
              <text x="55" y="58" textAnchor="middle" className="st-val">
                <tspan className="num">{b.level}</tspan><tspan className="unit"> из {b.cap}</tspan>
              </text>
              {b.eta_min != null && b.eta_min < 480 && (
                <text x="55" y="78" textAnchor="middle" className="st-val">
                  <tspan className="unit">{b.direction === "filling" ? "заполнится" : "опустеет"} через {dur(b.eta_min)}</tspan>
                </text>
              )}
            </g>
          );
        })}

        {layout.stations.map((s) => {
          const l = live[s.id];
          const risky = l.risk_level !== "low" && l.state !== "down";
          return (
            <g key={s.id} transform={`translate(${s.x},${s.y})`}
              className={`st ${l.state} ${selected === s.id ? "sel" : ""}`}
              role="button" tabIndex={0} aria-pressed={selected === s.id}
              aria-label={`${s.name}: ${STATE_LABEL[l.state]}, риск отказа ${Math.round(l.risk * 100)} %`}
              onClick={() => onSelect(selected === s.id ? null : s.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(s.id); } }}>
              <rect x="-70" y="-58" width="140" height="124" className="hit" />
              {bn === s.id && <path d="M-40,-40h80v80h-80z" className="bn-mark" />}
              <circle r="27" className="bezel" />
              {risky && <circle r="35" className={`risk-ring ${l.risk_level}`} />}
              <circle r="21" className="lamp" />
              <text y="6" textAnchor="middle" className="st-id">{s.id}</text>
              <text y="-46" textAnchor="middle" className="st-name">{s.name.toUpperCase()}</text>
              {l.state === "down" ? (
                <text y="58" textAnchor="middle" className="st-alarm">{l.cause} · {dur(l.down_min)}</text>
              ) : l.state === "run" ? (
                <text y="58" textAnchor="middle" className="st-val">
                  <tspan className="num">{int(l.units_h)}</tspan><tspan className="unit"> шт/ч</tspan>
                  {risky && <tspan className="ai"> · риск {Math.round(l.risk * 100)} %</tspan>}
                </text>
              ) : (
                <text y="58" textAnchor="middle" className="st-val"><tspan className="unit">{STATE_LABEL[l.state].toLowerCase()}</tspan></text>
              )}
            </g>
          );
        })}

        <g className="legend" transform={`translate(40,${layout.canvas.h - 26})`}>
          {([["run", "работает"], ["idle", "ждёт подачи или затор"], ["down", "простой"], ["planned", "плановое ТО"]] as const).map(([k, t], i) => (
            <g key={k} transform={`translate(${[0, 130, 380, 500][i]},0)`}>
              <circle r="7" className={`lg ${k}`} /><text x="14" y="4.5">{t}</text>
            </g>
          ))}
          <g transform="translate(680,0)"><circle r="8" className="risk-ring high still" /><text x="16" y="4.5">прогноз ИИ: риск отказа в ближайшие {snap.horizon_h} ч</text></g>
          <g transform="translate(1160,0)"><path d="M-8,-8h16v16h-16z" className="bn-mark" /><text x="16" y="4.5">узкое место</text></g>
        </g>
      </svg>
    </div>
  );
}
