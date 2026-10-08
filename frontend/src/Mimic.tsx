import { memo, useMemo, useRef } from "react";
import { dur, int, Layout, Snapshot, StateName, StationLive, STATE_LABEL } from "./api";

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

interface NodeProps {
  id: string; name: string; x: number; y: number; state: StateName; cause: string | null; downMin: number;
  unitsH: number; riskPct: number; level: StationLive["risk_level"]; selected: boolean; bottleneck: boolean;
  onSelect: (id: string | null) => void;
}

// пост перерисовывается, только когда меняется что-то из показанного им самим
const StationNode = memo(function StationNode({
  id, name, x, y, state, cause, downMin, unitsH, riskPct, level, selected, bottleneck, onSelect,
}: NodeProps) {
  const risky = level !== "low" && state !== "down";
  return (
    <g transform={`translate(${x},${y})`}
      className={`st ${state} ${selected ? "sel" : ""}`}
      role="button" tabIndex={0} aria-pressed={selected}
      aria-label={`${name}: ${STATE_LABEL[state]}, риск отказа ${riskPct} %`}
      onClick={() => onSelect(selected ? null : id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(id); } }}>
      <rect x="-70" y="-58" width="140" height="140" className="hit" />
      {bottleneck && <path d="M-40,-40h80v80h-80z" className="bn-mark" />}
      <circle r="27" className="bezel" />
      {/* кольцо и строка риска не снимаются, а гаснут: место под них занято всегда */}
      <circle r="35" className={`risk-ring ${level} ${risky ? "" : "off"}`} />
      <circle r="21" className="lamp" />
      <text y="6" textAnchor="middle" className="st-id">{id}</text>
      <text y="-46" textAnchor="middle" className="st-name">{name.toUpperCase()}</text>
      {state === "down" ? (
        <text y="58" textAnchor="middle" className="st-alarm">{cause} · {dur(downMin)}</text>
      ) : state === "run" ? (
        <text y="58" textAnchor="middle" className="st-val">
          <tspan className="num">{int(unitsH)}</tspan><tspan className="unit"> шт/ч</tspan>
        </text>
      ) : (
        <text y="58" textAnchor="middle" className="st-val"><tspan className="unit">{STATE_LABEL[state].toLowerCase()}</tspan></text>
      )}
      <text y="78" textAnchor="middle" className={`st-risk ${risky ? "" : "off"}`}>риск {riskPct} %</text>
    </g>
  );
});

export function Mimic({
  layout, snap, selected, onSelect,
}: { layout: Layout; snap: Snapshot; selected: string | null; onSelect: (id: string | null) => void }) {
  const geo = useMemo(() => {
    const g = geometry(chamfer(layout.path as P[], 36));
    const d = layout.stations.map((s) => g.distOf([s.x, s.y]));
    // отрезки потока между постами: рисуются всегда, выключенные гаснут, чтобы точки шли в одной фазе
    const segs = [...d.map((to, i) => g.slice(i === 0 ? 0 : d[i - 1], to)), g.slice(d[d.length - 1], g.total)];
    const zones = layout.shops.map((shop) => {
      const ss = layout.stations.filter((s) => s.shop === shop.id);
      const xs = ss.map((s) => s.x);
      return { shop, x0: Math.min(...xs) - 64, x1: Math.max(...xs) + 64, y: ss[0].y };
    });
    return { ...g, d, segs, zones };
  }, [layout]);
  const live = Object.fromEntries(snap.stations.map((s) => [s.id, s]));
  const bn = snap.bottleneck?.station;
  // тон накопителя — по открытому инциденту: сервер поднимает его с запасом и у порога он не мигает
  const alarmed = new Set(snap.incidents.filter((i) => i.open && i.type === "buffer").map((i) => i.station));
  // «шт/ч» скользит на ±1 почти каждый такт: показанное число меняем только при сдвиге на 2 и больше
  const shown = useRef<Record<string, number>>({});
  for (const s of snap.stations) {
    const was = shown.current[s.id];
    if (was == null || s.state !== "run" || Math.abs(s.units_h - was) >= 2) shown.current[s.id] = s.units_h;
  }
  const { w, h } = layout.canvas;

  return (
    <div className="mimic-scroll">
      <svg className="mimic" viewBox={`0 0 ${w} ${h}`}
        role="group" aria-label="Мнемосхема завода">
        <defs>
          <pattern id="tiles" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="var(--tile)" strokeWidth="1" />
          </pattern>
        </defs>
        {/* плитка шире холста: схема вписывается в область целиком, поля вокруг неё остаются щитом */}
        <rect x={-w} y={-h} width={3 * w} height={3 * h} fill="url(#tiles)" onClick={() => onSelect(null)} />

        {geo.zones.map(({ shop, x0, x1, y }) => (
          <g key={shop.id} className="zone">
            <path d={`M${x0},${y - 80}v-8H${x1}v8`} />
            <text x={(x0 + x1) / 2} y={y - 100} textAnchor="middle">{x1 - x0 < 200 ? shop.name : shop.full}</text>
          </g>
        ))}

        <path d={geo.slice(0, geo.total)} className="pipe" />
        {geo.segs.map((d, i) => {
          const feeder = layout.stations[i === 0 ? 0 : i - 1].id;
          return <path key={i} d={d} className={live[feeder]?.state === "run" ? "flow" : "flow off"} />;
        })}
        {/* подпись стоит вдоль торца линии: над линией её закрывала бы лампа первого поста */}
        <text transform={`translate(${layout.path[0][0] - 12},${layout.path[0][1]}) rotate(-90)`} textAnchor="middle" className="terminal">ПОСТАВЩИКИ</text>
        <text x={w - 40} y={layout.path[layout.path.length - 1][1] - 16} textAnchor="end" className="terminal">ДИЛЕРАМ</text>

        {snap.buffers.map((b) => {
          const spec = layout.buffers.find((x) => x.id === b.id);
          if (!spec) return null;
          const cells = 10, filled = Math.round((b.level / b.cap) * cells);
          const tone = alarmed.has(b.id) ? "warn" : "";
          const eta = b.eta_min != null && b.eta_min < 480 && b.direction !== "stable";
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
              <text x="55" y="78" textAnchor="middle" className="st-val">
                <tspan className="unit">{!eta ? "уровень стабилен"
                  : b.eta_min! < 1 ? (b.direction === "filling" ? "заполнен" : "пуст")
                  : `${b.direction === "filling" ? "заполнится" : "опустеет"} через ${dur(b.eta_min!)}`}</tspan>
              </text>
            </g>
          );
        })}

        {layout.stations.map((s) => {
          const l = live[s.id];
          return l ? (
            <StationNode key={s.id} id={s.id} name={s.name} x={s.x} y={s.y} state={l.state} cause={l.cause}
              downMin={l.down_min} unitsH={shown.current[s.id]} riskPct={Math.round(l.risk * 100)} level={l.risk_level}
              selected={selected === s.id} bottleneck={bn === s.id} onSelect={onSelect} />
          ) : null;
        })}

        <g className="legend" transform={`translate(40,${h - 26})`}>
          {([["run", "работает"], ["idle", "ждёт подачи или затор"], ["down", "простой"]] as const).map(([k, t], i) => (
            <g key={k} transform={`translate(${[0, 130, 380][i]},0)`}>
              <circle r="7" className={`lg ${k}`} /><text x="14" y="4.5">{t}</text>
            </g>
          ))}
          <g transform="translate(540,0)"><circle r="8" className="risk-ring high still" /><text x="16" y="4.5">прогноз ИИ: риск отказа в ближайшие {snap.horizon_h} ч работы</text></g>
          <g transform="translate(1060,0)"><path d="M-8,-8h16v16h-16z" className="bn-mark" /><text x="16" y="4.5">узкое место</text></g>
        </g>
      </svg>
    </div>
  );
}
