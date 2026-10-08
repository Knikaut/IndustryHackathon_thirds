import { Html, OrbitControls } from "@react-three/drei";
import { Canvas, RootState, useFrame, useThree } from "@react-three/fiber";
import { MutableRefObject, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { dur, int, Layout, pct, Snapshot, StateName, StationLive, StationSpec } from "./api";
import { Feed, Passport } from "./Board";
import { Box, C, GLASS, PAINTS, V2, V3 } from "./kit3d";
import { chamfer, geometry } from "./Mimic";
import { Rig } from "./Rigs";
import { inHall, Site } from "./Site";

const STATE_COLOR: Record<StateName, string> = { run: C.ok, starved: C.idle, blocked: C.idle, down: C.bad, planned: C.planned, off: "#4b525b" };
const BARE = "#8f98a3", ECOAT = "#4a4f57", PRIMER = "#d5d8d4", WOOD = "#c9a36b", ROAD = "#8b8f93";
// после какого поста кузов меняет вид: пол, боковины, крыша, навесные панели, катафорез, грунт, эмаль, стёкла, шасси, колёса, фары
const STAGE_AFTER = ["W1", "W2", "W3", "W4", "P1", "P2", "P3", "A1", "A2", "A3", "A4"];
const SPEED = 1.5, GAP = 2.3;

type Geo = ReturnType<typeof geometry>;

function Station3D({
  spec, pos, live, selected, bottleneck, far, onSelect,
}: { spec: StationSpec; pos: V2; live: StationLive; selected: boolean; bottleneck: boolean; far: boolean; onSelect: (id: string | null) => void }) {
  const [hover, setHover] = useState(false);
  const lamp = useRef<THREE.MeshStandardMaterial>(null);
  const ring = useRef<THREE.Group>(null);
  const pulse = useRef<THREE.Mesh>(null);
  const down = live.state === "down";
  const risky = live.risk_level !== "low" && !down;
  const high = live.risk_level === "high";
  useFrame(({ clock }, dt) => {
    if (lamp.current) lamp.current.emissiveIntensity = down ? (Math.sin(clock.elapsedTime * 7) > 0 ? 1.8 : 0.1) : 0.9;
    if (ring.current) ring.current.rotation.y += dt * (high ? 1.3 : 0.45);
    if (pulse.current) {
      const t = (clock.elapsedTime * 0.7) % 1;
      pulse.current.scale.setScalar(1 + t * 0.45);
      (pulse.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - t);
    }
  });
  useEffect(() => () => { document.body.style.cursor = ""; }, []);
  const color = STATE_COLOR[live.state];
  const open = selected || hover;
  // бирка над самим постом; тревожные поверх обычных, выбранная поверх всех
  const z = selected ? 60 : down ? 50 : risky ? 40 : 20;
  return (
    <group position={[pos[0], 0, pos[1]]}>
      <Rig rig={spec.rig} running={live.state === "run"} phase={pos[0] * 1.7 + pos[1]} />

      <mesh position={[-1.75, 1.3, -2.4]} castShadow><cylinderGeometry args={[0.05, 0.05, 2.6, 8]} /><meshStandardMaterial color={C.ink} /></mesh>
      <mesh position={[-1.75, 2.75, -2.4]}>
        <sphereGeometry args={[0.26, 20, 20]} />
        <meshStandardMaterial ref={lamp} color={color} emissive={color} emissiveIntensity={0.9} />
      </mesh>

      {down && (
        <mesh position={[0, 0.075, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[2.1, 40]} /><meshBasicMaterial color={C.bad} transparent opacity={0.22} depthWrite={false} /></mesh>
      )}
      {risky && (
        <group ref={ring} position={[0, 0.08, 0]}>
          {[0, 1, 2, 3, 4, 5].map((k) => (
            <mesh key={k} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[2.0, high ? 2.3 : 2.14, 16, 1, (k * Math.PI) / 3, high ? 0.75 : 0.55]} />
              <meshBasicMaterial color={C.ai} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      )}
      {risky && high && (
        <mesh ref={pulse} position={[0, 0.07, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[2.35, 2.5, 48]} /><meshBasicMaterial color={C.ai} transparent opacity={0.6} side={THREE.DoubleSide} depthWrite={false} />
        </mesh>
      )}
      {bottleneck && ([[-2.4, -2.4], [2.4, -2.4], [-2.4, 2.4], [2.4, 2.4]] as V2[]).map(([x, zz]) => (
        <group key={`${x}${zz}`} position={[x, 0.09, zz]}>
          <Box p={[-Math.sign(x) * 0.35, 0, 0]} s={[0.8, 0.05, 0.12]} c={C.warn} />
          <Box p={[0, 0, -Math.sign(zz) * 0.35]} s={[0.12, 0.05, 0.8]} c={C.warn} />
        </group>
      ))}
      {selected && (
        <mesh position={[0, 0.085, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[2.6, 2.75, 48]} /><meshBasicMaterial color={C.ink} /></mesh>
      )}

      <mesh position={[0, 1.3, -0.4]}
        onClick={(e) => { e.stopPropagation(); onSelect(selected ? null : spec.id); }}
        onPointerOver={(e) => { e.stopPropagation(); setHover(true); document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ""; }}>
        <boxGeometry args={[4.2, 2.6, 5.4]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {(!far || down || risky || open) && (
        <Html position={[0, 3.3, 0]} center zIndexRange={[z, z - 10]} style={{ pointerEvents: "none" }}>
          <div className={`tag3d ${live.state} ${risky ? "risky" : ""} ${open ? "open" : ""}`}>
            <b>{spec.id}</b>
            {open && <span>{spec.name}</span>}
            {down && <em>{open ? `${live.cause} · ${dur(live.down_min)}` : "простой"}</em>}
            {risky && <em className="ai">риск {Math.round(live.risk * 100)} %</em>}
            {open && live.state === "run" && !risky && <em className="plain">{int(live.units_h)} шт/ч</em>}
          </div>
        </Html>
      )}
    </group>
  );
}

// --- поток кузовов -----------------------------------------------------------
/**
 * Кузов собирается на глазах: ящик с комплектом, пол, каркас боковин, крыша, затем
 * закрытый кузов, который темнеет после катафореза, светлеет после грунта, получает
 * цвет, стёкла, колёса и фары. За воротами корпуса машина едет по дороге своим ходом.
 */
function Bodies({ geo, dist, states, stages }: { geo: Geo; dist: number[]; states: MutableRefObject<StateName[]>; stages: number[] }) {
  const n = Math.min(90, Math.floor(geo.total / (GAP * 1.25)));
  const refs = useRef<(THREE.Group | null)[]>([]);
  const sim = useMemo(() => ({
    bodies: Array.from({ length: n }, (_, i) => ({ d: geo.total - (i + 0.5) * (geo.total / n), paint: PAINTS[i % PAINTS.length], stage: -1 })),
    order: Array.from({ length: n }, (_, i) => i),   // от головы линии к хвосту
    pool: [] as number[],
    mats: Array.from({ length: n }, () => new THREE.MeshStandardMaterial({ color: BARE, roughness: 0.45, metalness: 0.25 })),
  }), [n, geo]);

  useFrame((_, raw) => {
    const dt = Math.min(raw, 0.1), st = states.current, { bodies, order, pool, mats } = sim;
    // участок движется, если пост в его начале работает
    const flowing = (d: number) => {
      let i = 0;
      while (i < dist.length && dist[i] < d) i++;
      return st[Math.max(0, Math.min(i - 1, st.length - 1))] === "run";
    };
    for (let k = 0; k < order.length; k++) {
      const b = bodies[order[k]];
      const ahead = k > 0 ? bodies[order[k - 1]].d : Infinity;
      if (flowing(b.d)) b.d = Math.max(b.d, Math.min(b.d + SPEED * dt, ahead - GAP));
    }
    if (order.length && bodies[order[0]].d >= geo.total) {
      const i = order.shift()!;
      bodies[i].d = -1;
      pool.push(i);
    }
    if (pool.length && st[0] === "run" && (!order.length || bodies[order[order.length - 1]].d > GAP)) {
      const i = pool.shift()!;
      bodies[i].d = 0;
      bodies[i].paint = PAINTS[Math.floor(Math.random() * PAINTS.length)];
      bodies[i].stage = -1;
      order.push(i);
    }
    bodies.forEach((b, i) => {
      const g = refs.current[i];
      if (!g) return;
      g.visible = b.d >= 0;
      if (b.d < 0) return;
      const [x, z] = geo.at(b.d), [x2, z2] = geo.at(Math.min(geo.total, b.d + 0.3));
      g.position.set(x, 0, z);
      if (x2 !== x || z2 !== z) g.rotation.y = Math.atan2(-(z2 - z), x2 - x);
      let s = 0;
      while (s < stages.length && b.d > stages[s]) s++;
      if (s !== b.stage) {
        b.stage = s;
        const [skid, crate, floor, frame, roof, lower, cabin, glass, wheels, lights] = g.children;
        skid.visible = s < 12;
        crate.visible = s === 0;
        floor.visible = s >= 1 && s <= 3;
        frame.visible = s === 2 || s === 3;
        roof.visible = s === 3;
        lower.visible = cabin.visible = s >= 4;
        glass.visible = s >= 8;
        wheels.visible = s >= 10;
        lights.visible = s >= 11;
        mats[i].color.set(s <= 4 ? BARE : s === 5 ? ECOAT : s === 6 ? PRIMER : b.paint);
      }
    });
  });

  return (
    <>
      {sim.bodies.map((_, i) => {
        const m = sim.mats[i];
        return (
          <group key={i} ref={(el) => { refs.current[i] = el; }}>
            <mesh position={[0, 0.2, 0]}><boxGeometry args={[1.5, 0.08, 0.5]} /><meshStandardMaterial color={C.ink} /></mesh>
            <mesh position={[0, 0.56, 0]} castShadow><boxGeometry args={[1.4, 0.62, 0.8]} /><meshStandardMaterial color={WOOD} /></mesh>
            <mesh position={[0, 0.3, 0]} material={m} castShadow><boxGeometry args={[1.7, 0.1, 0.82]} /></mesh>
            {/* каркас боковин: пороги, стойки, брусья крыши, передок и задок */}
            <group>
              {[-0.38, 0.38].map((z) => (
                <group key={z} position={[0, 0, z]}>
                  <mesh position={[0, 0.42, 0]} material={m} castShadow><boxGeometry args={[1.7, 0.16, 0.07]} /></mesh>
                  <mesh position={[-0.08, 0.93, 0]} material={m}><boxGeometry args={[0.95, 0.06, 0.07]} /></mesh>
                  {[-0.52, -0.08, 0.36].map((x) => <mesh key={x} position={[x, 0.7, 0]} material={m}><boxGeometry args={[0.07, 0.46, 0.07]} /></mesh>)}
                </group>
              ))}
              <mesh position={[0.82, 0.45, 0]} material={m}><boxGeometry args={[0.06, 0.22, 0.82]} /></mesh>
              <mesh position={[-0.82, 0.45, 0]} material={m}><boxGeometry args={[0.06, 0.22, 0.82]} /></mesh>
            </group>
            <mesh position={[-0.08, 0.97, 0]} material={m} castShadow><boxGeometry args={[0.97, 0.05, 0.83]} /></mesh>
            <mesh position={[0, 0.5, 0]} material={m} castShadow><boxGeometry args={[1.7, 0.32, 0.82]} /></mesh>
            <mesh position={[-0.08, 0.8, 0]} material={m} castShadow><boxGeometry args={[0.9, 0.3, 0.72]} /></mesh>
            <mesh position={[-0.08, 0.79, 0]}><boxGeometry args={[0.94, 0.16, 0.76]} /><meshStandardMaterial color={GLASS} roughness={0.2} /></mesh>
            <group visible={false}>
              {([[-0.55, 0.42], [0.55, 0.42], [-0.55, -0.42], [0.55, -0.42]] as V2[]).map(([x, z]) => (
                <mesh key={`${x}${z}`} position={[x, 0.3, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.2, 0.2, 0.14, 14]} /><meshStandardMaterial color="#14181f" /></mesh>
              ))}
            </group>
            <group visible={false}>
              {[-0.28, 0.28].map((z) => <mesh key={z} position={[0.86, 0.52, z]}><boxGeometry args={[0.03, 0.1, 0.18]} /><meshBasicMaterial color="#fff6c9" /></mesh>)}
            </group>
          </group>
        );
      })}
    </>
  );
}

/** Лента конвейера внутри корпуса и на площадке комплектов; за воротами корпуса дорога. */
function Conveyor({ pts, exitD }: { pts: V2[]; exitD: number }) {
  const parts = useMemo(() => {
    const out: { a: V2; b: V2; road: boolean }[] = [];
    let d = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (d + len <= exitD || d >= exitD) out.push({ a, b, road: d >= exitD });
      else {
        const t = (exitD - d) / len, m: V2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
        out.push({ a, b: m, road: false }, { a: m, b, road: true });
      }
      d += len;
    }
    return out;
  }, [pts, exitD]);
  return (
    <>
      {parts.map(({ a, b, road }, i) => {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        return (
          <group key={i} position={[(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2]} rotation={[0, Math.atan2(-(b[1] - a[1]), b[0] - a[0]), 0]}>
            {road ? (
              <>
                <Box p={[0, 0.075, 0]} s={[len + 0.9, 0.05, 2.0]} c={ROAD} />
                <Box p={[0, 0.105, 0.9]} s={[len + 0.9, 0.01, 0.07]} c="#f7f8f5" />
                <Box p={[0, 0.105, -0.9]} s={[len + 0.9, 0.01, 0.07]} c="#f7f8f5" />
              </>
            ) : (
              <>
                <Box p={[0, 0.09, 0]} s={[len + 0.5, 0.1, 1.5]} c={C.ink} />
                <Box p={[0, 0.145, 0.68]} s={[len + 0.5, 0.05, 0.08]} c={C.yellow} />
                <Box p={[0, 0.145, -0.68]} s={[len + 0.5, 0.05, 0.08]} c={C.yellow} />
              </>
            )}
          </group>
        );
      })}
    </>
  );
}

/** Накопитель: стеллаж с кузовами. После сварки кузова голые, после окраски цветные. */
function Rack({ pos, level, cap, name, warn, painted, zoom }: { pos: V2; level: number; cap: number; name: string; warn: boolean; painted: boolean; zoom: number }) {
  const short = name.replace(/^Кузова /, "");
  const cols = 10, rows = Math.ceil(cap / cols), step = 0.46;
  return (
    <group position={[pos[0], 0, pos[1] - 2.3]}>
      {[-2.4, 0, 2.4].map((x) => <Box key={x} p={[x, (rows * step + 0.3) / 2, 0]} s={[0.1, rows * step + 0.3, 0.9]} c={C.ink} />)}
      {Array.from({ length: rows + 1 }, (_, r) => <Box key={r} p={[0, 0.2 + r * step, 0]} s={[4.9, 0.05, 0.9]} c={C.steel} />)}
      {Array.from({ length: Math.min(level, cap) }, (_, k) => {
        const c = k % cols, r = Math.floor(k / cols), col = painted ? PAINTS[(k * 7) % PAINTS.length] : BARE;
        return (
          <group key={k} position={[(c - 4.5) * 0.47, 0.23 + r * step, 0]}>
            <Box p={[0, 0.09, 0]} s={[0.34, 0.14, 0.74]} c={col} />
            <Box p={[0, 0.22, -0.03]} s={[0.3, 0.12, 0.38]} c={col} />
          </group>
        );
      })}
      <Html position={[0, rows * step + 1.0, 0]} center zIndexRange={[30, 20]} style={{ pointerEvents: "none" }}>
        <div className={`tag3d buffer ${zoom === 0 ? "open" : ""} ${warn ? "warn" : ""}`}>
          {zoom < 2 && <span>{zoom === 0 ? name : short}</span>}<em className="plain">{level}{zoom === 0 ? " из " : "/"}{cap}</em>
        </div>
      </Html>
    </group>
  );
}

function Zone({ name, x0, x1, z, indoor, zoom }: { name: string; x0: number; x1: number; z: number; indoor: boolean; zoom: number }) {
  const w = x1 - x0, cx = (x0 + x1) / 2, panes = Math.max(1, Math.round(w / 2.4));
  if (!indoor) {
    // на открытой площадке название висит на указателе рядом с первым постом
    return (
      <group position={[x0 - 0.9, 0, z + 3.3]}>
        <Box p={[0, 1.5, 0]} s={[0.1, 3.0, 0.1]} c={C.ink} />
        <Html position={[0, 3.2, 0]} center zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div className="zone3d sign">{name}</div>
        </Html>
      </group>
    );
  }
  return (
    <group>
      <mesh position={[cx, 0.03, z - 0.6]} receiveShadow><boxGeometry args={[w, 0.06, 6.2]} /><meshStandardMaterial color={C.slab} /></mesh>
      <Box p={[cx, 0.85, z - 3.62]} s={[w, 1.7, 0.16]} c={C.wall} />
      <Box p={[cx, 1.74, z - 3.62]} s={[w + 0.1, 0.1, 0.24]} c={C.ink} />
      {Array.from({ length: panes }, (_, k) => (
        <Box key={k} p={[x0 + (w / panes) * (k + 0.5), 1.05, z - 3.53]} s={[1.1, 0.55, 0.02]} c={C.glass} />
      ))}
      {/* название цеха лежит в проезде перед цехом и не спорит с бирками постов */}
      {zoom < 2 && (
        <Html position={[x0 + 0.3, 0.12, z + 3.2]} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
          <div className="zone3d floor">{name}</div>
        </Html>
      )}
    </group>
  );
}

/** Плавный подлёт камеры к цели; ручное управление прерывает подлёт. */
function CameraRig({ target, distance, home, onZoom }: { target: V3; distance: number; home: number; onZoom: (zoom: number) => void }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void; addEventListener: (t: string, f: () => void) => void; removeEventListener: (t: string, f: () => void) => void } | null;
  const flying = useRef(true);
  const last = useRef(2);
  const goal = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useEffect(() => { flying.current = true; }, [target[0], target[2], distance, home]);
  useEffect(() => {
    if (!controls) return;
    const stop = () => { flying.current = false; };
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);
  useFrame((_, dt) => {
    if (!controls) return;
    // 0 вблизи, 1 общий план, 2 издалека: чем дальше, тем меньше подписей
    const d = camera.position.distanceTo(controls.target), zoom = d < 95 ? 0 : d < 205 ? 1 : 2;
    if (zoom !== last.current) { last.current = zoom; onZoom(zoom); }
    if (!flying.current) return;
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 3);
    goal.set(...target);
    tmp.copy(camera.position).sub(controls.target).normalize().multiplyScalar(distance);
    controls.target.lerp(goal, k);
    tmp.add(goal);
    camera.position.lerp(tmp, k);
    controls.update();
    if (camera.position.distanceTo(tmp) < 0.04) flying.current = false;
  });
  return null;
}

function Scene({ layout, snap, selected, onSelect, roof, home }: Props & { roof: boolean; home: number }) {
  const [zoom, setZoom] = useState(2);
  const world = useMemo(() => {
    const ys = layout.stations.map((s) => s.y);
    const cx = layout.canvas.w / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    // место на площадке задаёт бэкенд (site, path3d); без него сцена строится по плоской схеме
    const to = (o: { x: number; y: number; site?: V2 }): V2 => o.site ?? [(o.x - cx) / 40, ((o.y - cy) / 40) * 1.5];
    const pts = chamfer(layout.path3d ?? layout.path.map(([x, y]) => to({ x, y })), 2);
    const geo = geometry(pts);
    const pos = Object.fromEntries(layout.stations.map((s) => [s.id, to(s)])) as Record<string, V2>;
    const dist = layout.stations.map((s) => geo.distOf(pos[s.id]));
    const byId = Object.fromEntries(layout.stations.map((st, i) => [st.id, dist[i]]));
    const known = STAGE_AFTER.every((id) => id in byId);
    const stages = STAGE_AFTER.map((id, k) => (known ? byId[id] + 0.4 : (geo.total * (k + 1)) / (STAGE_AFTER.length + 3)));
    // ворота корпуса: первая точка трассы снаружи после последнего поста внутри
    const lastIn = Math.max(0, ...layout.stations.map((s, i) => (inHall(pos[s.id]) ? dist[i] : 0)));
    let exitD = lastIn;
    while (exitD < geo.total && inHall(geo.at(exitD))) exitD += 0.25;
    if (lastIn === 0) exitD = geo.total;
    stages.push(exitD + 0.8);
    const zones = layout.shops.map((shop) => {
      const ss = layout.stations.filter((s) => s.shop === shop.id).map((s) => pos[s.id]);
      return { shop, x0: Math.min(...ss.map((p) => p[0])) - 2.2, x1: Math.max(...ss.map((p) => p[0])) + 2.2, z: ss[0][1], indoor: ss.every(inHall) };
    }).filter((z) => Number.isFinite(z.x0));
    const shopOf = Object.fromEntries(layout.stations.map((s) => [s.id, s.shop]));
    return { to, pts, geo, pos, dist, stages, zones, exitD, shopOf };
  }, [layout]);

  const live = Object.fromEntries(snap.stations.map((s) => [s.id, s]));
  // тон накопителя — по открытому инциденту: сервер поднимает его с запасом и у порога он не мигает
  const alarmed = new Set(snap.incidents.filter((i) => i.open && i.type === "buffer").map((i) => i.station));
  const states = useRef<StateName[]>([]);
  states.current = layout.stations.map((s) => live[s.id].state);

  const sel = selected ? world.pos[selected] : null;
  // на широком экране цель смещена вправо, чтобы завод не уходил под боковую панель;
  // на узком панель стоит под сценой, а общий план отодвигается, чтобы завод поместился
  const size = useThree((st) => st.size);
  const narrow = size.width < 900;
  // #twin@x,z,расстояние в адресе наводит общий план на нужный участок площадки
  const focus = useMemo(() => window.location.hash.match(/@(-?[\d.]+),(-?[\d.]+),([\d.]+)/)?.slice(1).map(Number), []);
  const target: V3 = sel ? [sel[0] + (narrow ? 0 : 3.5), 0.8, sel[1]] : focus ? [focus[0], 0, focus[1]] : [narrow ? -16 : -1, 0, -13];
  const overview = focus ? focus[2] : narrow ? Math.min(330, 200 / (size.width / size.height)) : 168;

  return (
    <>
      <color attach="background" args={["#d9d5c8"]} />
      <fog attach="fog" args={["#d9d5c8", 380, 820]} />
      <hemisphereLight args={["#ffffff", "#c9c3b2", 1.15]} />
      <directionalLight position={[40, 70, 34]} intensity={1.9} castShadow
        shadow-mapSize={[4096, 4096]} shadow-camera-left={-95} shadow-camera-right={70}
        shadow-camera-top={70} shadow-camera-bottom={-60} shadow-camera-far={220} shadow-bias={-0.0005} />
      <Site roof={roof} detail={zoom === 0} />

      {world.zones.map((z) => <Zone key={z.shop.id} name={z.shop.full} x0={z.x0} x1={z.x1} z={z.z} indoor={z.indoor} zoom={zoom} />)}
      <Conveyor pts={world.pts} exitD={world.exitD} />
      <Bodies geo={world.geo} dist={world.dist} states={states} stages={world.stages} />
      {layout.stations.map((s) => (
        <Station3D key={s.id} spec={s} pos={world.pos[s.id]} live={live[s.id]} selected={selected === s.id}
          bottleneck={snap.bottleneck?.station === s.id} far={zoom === 2} onSelect={onSelect} />
      ))}
      {snap.buffers.map((b) => {
        const spec = layout.buffers.find((x) => x.id === b.id);
        return spec ? (
          <Rack key={b.id} pos={world.to(spec)} level={b.level} cap={b.cap} name={b.name}
            warn={alarmed.has(b.id)} painted={world.shopOf[spec.after] === "PAINT"} zoom={zoom} />
        ) : null;
      })}

      <OrbitControls makeDefault enableDamping dampingFactor={0.12} minDistance={9} maxDistance={340}
        minPolarAngle={0.25} maxPolarAngle={1.32} />
      <CameraRig target={target} distance={sel ? 27 : overview} home={home} onZoom={setZoom} />
    </>
  );
}

interface Props { layout: Layout; snap: Snapshot; selected: string | null; onSelect: (id: string | null) => void }

/** active = false: экран спрятан (открыт другой раздел), сцена остаётся в памяти, но кадры не рисуются. */
export default function Twin3D({ active = true, onReady, ...props }: Props & { active?: boolean; onReady?: () => void }) {
  const { snap, selected, onSelect } = props;
  const k = snap.kpi;
  // как на «Щите»: в первые полчаса смены доли считаются по одной-двум машинам
  const early = k.sched_hours < 0.5;
  const three = useRef<RootState | null>(null);
  // спрятанный холст имеет нулевой размер и новых свойств не получает: цикл кадров останавливаем напрямую
  useEffect(() => { three.current?.setFrameloop(active ? "always" : "never"); }, [active]);
  const down = snap.stations.filter((s) => s.state === "down").length;
  const atRisk = snap.stations.filter((s) => s.risk_level === "high" && s.state !== "down").length;
  // сцена открывается видом со спутника; через мгновение крыша снимается и открывает линию
  const [roof, setRoof] = useState(true);
  const [home, setHome] = useState(0);
  useEffect(() => { const t = window.setTimeout(() => setRoof(false), 1900); return () => clearTimeout(t); }, []);
  return (
    <main className="twin" style={active ? undefined : { display: "none" }}>
      <div className="twin-stage">
        <Canvas shadows="percentage" dpr={[1, 2]} camera={{ fov: 30, near: 1, far: 1200, position: [36, 170, 190] }}
          frameloop={active ? "always" : "never"} onCreated={(state) => { three.current = state; onReady?.(); }}
          onPointerMissed={() => onSelect(null)} aria-label="Трёхмерная модель завода">
          <Scene {...props} roof={roof} home={home} />
        </Canvas>

        <section className="hud hud-kpi" aria-label="Показатели смены">
          <div><h2>Выпуск смены</h2><p className="num">{int(k.fact)}<small> из {int(k.plan)}</small></p></div>
          <div><h2>OEE</h2><p className="num">{early ? "—" : pct(k.oee, 0)}<small>{early ? "" : " %"}</small></p></div>
          <div><h2>Простои</h2><p className={`num ${down ? "bad" : ""}`}>{int(k.downtime_min)}<small> мин</small></p></div>
          <div><h2>Качество</h2><p className="num">{early ? "—" : pct(k.quality, 0)}<small>{early ? "" : " %"}</small></p></div>
          <div><h2>Стоит постов</h2><p className={`num ${down ? "bad" : ""}`}>{down}</p></div>
          <div><h2>Под риском</h2><p className={`num ${atRisk ? "ai" : ""}`}>{atRisk}</p></div>
        </section>

        <div className="hud hud-tools">
          <button aria-pressed={roof} onClick={() => setRoof(!roof)}>{roof ? "Снять крышу" : "Показать крышу"}</button>
          <button onClick={() => { onSelect(null); setHome(home + 1); }}>Общий план</button>
        </div>

        <p className="hud hud-hint">
          <span><i className="lg-dot ok" />работает</span><span><i className="lg-dot idle" />ждёт</span>
          <span><i className="lg-dot bad" />простой</span>
          <span><i className="lg-ring" />прогноз ИИ: риск отказа</span><span><i className="lg-corner" />узкое место</span>
          <span className="sep">Тяните, чтобы повернуть · колесо приближает · клик по посту открывает паспорт</span>
        </p>
      </div>

      <div className="hud-side">
        {/* у спрятанной сцены панели нет: иначе её паспорт опрашивал бы сервер вместе с паспортом «Щита» */}
        {!active ? null : selected
          ? <Passport id={selected} layout={props.layout} snap={snap} onClose={() => onSelect(null)} />
          : <Feed snap={snap} onSelect={onSelect} />}
      </div>
    </main>
  );
}
