import { Html } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { Box, Boxes, C, GLASS, Item, PAINTS, V2, V3 } from "./kit3d";

/**
 * Площадка завода по спутниковым снимкам. Координаты сняты с общего снимка 578×411 px:
 * 1 px = 0,2 единицы сцены, начало координат в центре главного корпуса. Детали участков
 * (контейнерная площадка, зона таможенного контроля, стоянки, ангары) уточнены по
 * крупным снимкам. Здания, площадки и пути стоят на своих местах; контейнеры, машины
 * и деревья расставлены в тех же зонах, но не поштучно. Масштаб машин увеличен.
 */
const K = 0.2, OX = 395, OY = 282;
const wx = (px: number) => (px - OX) * K, wz = (py: number) => (py - OY) * K;
const rect = (x0: number, y0: number, x1: number, y1: number) =>
  ({ cx: wx((x0 + x1) / 2), cz: wz((y0 + y1) / 2), w: (x1 - x0) * K, d: (y1 - y0) * K });
type R = ReturnType<typeof rect>;

export const HALL = { x0: wx(262), x1: wx(528), z0: wz(185), z1: wz(348) };
export const inHall = ([x, z]: V2) => x > HALL.x0 && x < HALL.x1 && z > HALL.z0 && z < HALL.z1;
/** Ряды линии внутри корпуса: сварка, окраска, сборка. */
const ROWS = [-9.5, -0.5, 8.5];

const G = {
  earth: "#cdc7b5", paved: "#dcdfdb", concrete: "#e6e8e3", asphalt: "#a3a6a8", floor: "#e4e9e5", roof: "#4b525b",
  roof2: "#59616b", sky: "#8b949e", white: "#f3f4f1", blueRoof: "#8fb4d9", greyRoof: "#b9bfc3", grass: "#a9bd95",
  field: "#6fae6a", rail: "#5b5f66", sleeper: "#8d8676", wagon: "#3a3f47", silver: "#cfd6da", wood: "#c9a36b",
  line: "#f7f8f5", walk: "#a9cdb0", fence: "#9aa1a6",
};
const BOXES = ["#2f62c9", "#2f62c9", "#3b6fd0", "#b5533c", "#d9822b", "#5c7a99", "#2f62c9", "#9c3f33", "#d8d3c4", "#c0392b"];
const FRESH = ["#f4f4f0", "#f4f4f0", "#f4f4f0", "#f4f4f0", "#2b2f36", "#9aa3ad", "#c0392b", "#1f4e9c"];

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function Flat({ r, c, y = 0.02, h = 0.04 }: { r: R; c: string; y?: number; h?: number }) {
  return <mesh position={[r.cx, y, r.cz]} receiveShadow><boxGeometry args={[r.w, h, r.d]} /><meshStandardMaterial color={c} roughness={0.95} /></mesh>;
}

function Building({ r, h, roof, wall = C.wall }: { r: R; h: number; roof: string; wall?: string }) {
  return (
    <group position={[r.cx, 0, r.cz]}>
      <Box p={[0, h / 2, 0]} s={[r.w, h, r.d]} c={wall} />
      <Box p={[0, h + 0.08, 0]} s={[r.w + 0.3, 0.16, r.d + 0.3]} c={roof} />
    </group>
  );
}

/** Арочный ангар: полуцилиндр вдоль длинной стороны. */
function Hangar({ r }: { r: R }) {
  const rad = r.d / 2;
  return (
    <group position={[r.cx, 0, r.cz]}>
      <mesh rotation={[0, 0, Math.PI / 2]} castShadow receiveShadow>
        <cylinderGeometry args={[rad, rad, r.w, 28, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color={G.silver} metalness={0.45} roughness={0.42} side={THREE.DoubleSide} />
      </mesh>
      {Array.from({ length: Math.floor(r.w / 2) }, (_, k) => (
        <mesh key={k} position={[-r.w / 2 + 1 + k * 2, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[rad + 0.03, rad + 0.03, 0.08, 28, 1, true, 0, Math.PI]} />
          <meshStandardMaterial color="#aab2b8" side={THREE.DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}

function Fence({ r }: { r: R }) {
  const y = 0.4, t = 0.07;
  return (
    <group position={[r.cx, 0, r.cz]}>
      <Box p={[0, y, -r.d / 2]} s={[r.w, 0.8, t]} c={G.fence} o={0.55} />
      <Box p={[0, y, r.d / 2]} s={[r.w, 0.8, t]} c={G.fence} o={0.55} />
      <Box p={[-r.w / 2, y, 0]} s={[t, 0.8, r.d]} c={G.fence} o={0.55} />
      <Box p={[r.w / 2, y, 0]} s={[t, 0.8, r.d]} c={G.fence} o={0.55} />
    </group>
  );
}

/** Полоса между двумя точками снимка: дороги и железнодорожные пути. */
function strip(x0: number, y0: number, x1: number, y1: number) {
  const a: V2 = [wx(x0), wz(y0)], b: V2 = [wx(x1), wz(y1)];
  return {
    pos: [(a[0] + b[0]) / 2, 0, (a[1] + b[1]) / 2] as V3,
    len: Math.hypot(b[0] - a[0], b[1] - a[1]),
    ry: Math.atan2(-(b[1] - a[1]), b[0] - a[0]),
    at: (t: number): V2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
  };
}

function Track({ s }: { s: ReturnType<typeof strip> }) {
  return (
    <group position={s.pos} rotation={[0, s.ry, 0]}>
      <Box p={[0, 0.13, 0.55]} s={[s.len, 0.1, 0.1]} c={G.rail} />
      <Box p={[0, 0.13, -0.55]} s={[s.len, 0.1, 0.1]} c={G.rail} />
    </group>
  );
}

function Tree({ p, s = 1 }: { p: V2; s?: number }) {
  return (
    <group position={[p[0], 0, p[1]]} scale={s}>
      <mesh position={[0, 0.45, 0]} castShadow><cylinderGeometry args={[0.09, 0.12, 0.9, 8]} /><meshStandardMaterial color={C.trunk} /></mesh>
      <mesh position={[0, 1.35, 0]} castShadow><icosahedronGeometry args={[0.7, 1]} /><meshStandardMaterial color={C.tree} flatShading /></mesh>
    </group>
  );
}

function Truck({ p, rot, cargo, cab = C.truck }: { p: V3; rot: number; cargo: string; cab?: string }) {
  return (
    <group position={p} rotation={[0, rot, 0]}>
      <Box p={[1.55, 0.75, 0]} s={[0.9, 0.9, 1.2]} c={cab} />
      <Box p={[1.8, 0.95, 0]} s={[0.42, 0.4, 1.1]} c={GLASS} />
      <Box p={[-0.35, 0.95, 0]} s={[2.8, 1.3, 1.25]} c={cargo} />
      {([[1.5, 0.6], [1.5, -0.6], [-0.2, 0.6], [-0.2, -0.6], [-1.2, 0.6], [-1.2, -0.6]] as V2[]).map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.28, z]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.28, 0.28, 0.2, 14]} /><meshStandardMaterial color="#14181f" /></mesh>
      ))}
    </group>
  );
}

function Label({ p, children }: { p: V3; children: string }) {
  return (
    <Html position={p} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
      <div className="zone3d">{children}</div>
    </Html>
  );
}

/** Тягач с тележками: возит комплектующие по проезду туда и обратно. */
function Tugger({ z, x0, x1, speed, phase }: { z: number; x0: number; x1: number; speed: number; phase: number }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    const span = x1 - x0, t = ((clock.elapsedTime * speed + phase) % (2 * span) + 2 * span) % (2 * span);
    const fwd = t < span;
    g.current.position.set(x0 + (fwd ? t : 2 * span - t), 0, z);
    g.current.rotation.y = fwd ? 0 : Math.PI;
  });
  return (
    <group ref={g}>
      <Box p={[0.9, 0.35, 0]} s={[0.9, 0.5, 0.6]} c={C.yellow} />
      <Box p={[0.75, 0.75, 0]} s={[0.4, 0.4, 0.5]} c={GLASS} o={0.6} />
      {[-0.3, -1.4].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <Box p={[0, 0.2, 0]} s={[0.9, 0.1, 0.6]} c={C.ink} />
          <Box p={[0, 0.5, 0]} s={[0.75, 0.5, 0.5]} c={G.wood} />
        </group>
      ))}
    </group>
  );
}

/** Крыша корпуса: при снятии поднимается и растворяется, открывая линию. */
function Roof({ on }: { on: boolean }) {
  const group = useRef<THREE.Group>(null);
  const t = useRef(0);
  const mats = useMemo(() => {
    const mk = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, transparent: true });
    return { a: mk(G.roof), b: mk(G.roof2), sky: mk("#ffffff") };
  }, []);
  const w = HALL.x1 - HALL.x0, seam = wz(295), cx = (HALL.x0 + HALL.x1) / 2;
  const marks = useMemo(() => {
    const out: Item[] = [];
    const cut = [HALL.x0 + w * 0.335, HALL.x0 + w * 0.675];
    const nearSeam = (x: number) => cut.some((c) => Math.abs(x - c) < 1.2);
    // верхняя часть: частая сетка парных фонарей; нижняя: по четыре ряда в каждой секции
    for (let x = HALL.x0 + 1.6; x < HALL.x1 - 1; x += 2.05) {
      if (nearSeam(x)) continue;
      for (let z = HALL.z0 + 1.7; z < seam - 1; z += 1.75) {
        out.push({ p: [x - 0.36, 0.14, z], s: [0.5, 0.08, 0.34], c: G.sky }, { p: [x + 0.36, 0.14, z], s: [0.5, 0.08, 0.34], c: G.sky });
      }
      for (let z = seam + 2.4; z < HALL.z1 - 2; z += 1.6) {
        if (Math.floor((x - HALL.x0) / 2.05) % 3 === 2) continue;
        out.push({ p: [x, 0.02, z], s: [0.9, 0.08, 0.34], c: G.sky });
      }
    }
    cut.forEach((c) => out.push({ p: [c, 0.12, (HALL.z0 + HALL.z1) / 2], s: [0.14, 0.06, HALL.z1 - HALL.z0], c: "#2f353d" }));
    return out;
  }, [w, seam]);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    t.current += ((on ? 0 : 1) - t.current) * (1 - Math.exp(-Math.min(dt, 0.1) * 3.5));
    g.position.y = 5.3 + t.current * 9;
    const opacity = 1 - t.current;
    g.visible = opacity > 0.03;
    Object.values(mats).forEach((m) => { m.opacity = opacity; m.depthWrite = opacity > 0.9; });
  });
  return (
    <group ref={group} position={[0, 5.3, 0]}>
      <mesh position={[cx, 0, (HALL.z0 + seam) / 2]} material={mats.a} castShadow><boxGeometry args={[w + 0.6, 0.2, seam - HALL.z0 + 0.3]} /></mesh>
      <mesh position={[cx, -0.12, (seam + HALL.z1) / 2]} material={mats.b} castShadow><boxGeometry args={[w + 0.6, 0.2, HALL.z1 - seam + 0.3]} /></mesh>
      <Boxes items={marks} shadow={false} material={mats.sky} />
    </group>
  );
}

function Hall({ detail }: { detail: boolean }) {
  const { x0, x1, z0, z1 } = HALL, w = x1 - x0, d = z1 - z0, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const H = 5.2, low = 1.1, gate = ROWS[0], exit = ROWS[2];
  const inside = useMemo(() => {
    const r = rng(5);
    const items: Item[] = [];
    // разметка: жёлтые границы проездов и зелёные пешеходные дорожки
    for (const a of [(ROWS[0] + ROWS[1]) / 2 - 0.65, (ROWS[1] + ROWS[2]) / 2 - 0.65]) {
      items.push({ p: [cx, 0.07, a - 1.15], s: [w - 3, 0.02, 0.1], c: C.yellow }, { p: [cx, 0.07, a + 1.15], s: [w - 3, 0.02, 0.1], c: C.yellow },
        { p: [cx, 0.065, a], s: [w - 3, 0.02, 0.7], c: G.walk });
    }
    items.push({ p: [cx, 0.07, ROWS[2] + 2.9], s: [w - 3, 0.02, 0.1], c: C.yellow });
    // склад штампованных деталей вдоль северной стены: тара с панелями кузова
    for (let x = x0 + 2.4; x < x1 - 21; x += 2.3) for (const z of [z0 + 1.6, z0 + 3.5]) {
      if (r() < 0.12) continue;
      items.push({ p: [x, 0.12, z], s: [1.7, 0.14, 1.0], c: C.ink }, { p: [x - 0.82, 0.6, z], s: [0.06, 0.9, 1.0], c: C.ink }, { p: [x + 0.82, 0.6, z], s: [0.06, 0.9, 1.0], c: C.ink });
      const n = 3 + Math.floor(r() * 4);
      for (let k = 0; k < n; k++) items.push({ p: [x - 0.6 + k * 0.22, 0.62, z], s: [0.05, 0.85, 0.85], c: "#8f98a3" });
    }
    // южный проезд: шины и сиденья для финальной сборки
    for (let x = x0 + 16; x < x0 + 36; x += 1.5) {
      const tall = 1 + Math.floor(r() * 3);
      for (let k = 0; k < tall; k++) items.push({ p: [x, 0.3 + k * 0.42, z1 - 1.0], s: [1.1, 0.4, 0.9], c: k % 2 ? "#3f6f9c" : "#55606b" });
    }
    return items;
  }, [x0, x1, z0, z1, w, cx]);
  return (
    <group>
      <mesh position={[cx, 0.03, cz]} receiveShadow><boxGeometry args={[w, 0.06, d]} /><meshStandardMaterial color={G.floor} roughness={0.95} /></mesh>
      <Box p={[cx, H / 2, z0]} s={[w + 0.4, H, 0.4]} c={C.wall} />
      <Box p={[cx, H + 0.06, z0]} s={[w + 0.5, 0.12, 0.5]} c={C.ink} />
      <Box p={[x0, H / 2, (z0 + gate - 2.2) / 2]} s={[0.4, H, gate - 2.2 - z0]} c={C.wall} />
      <Box p={[x0, H / 2, (gate + 2.2 + z1) / 2]} s={[0.4, H, z1 - gate - 2.2]} c={C.wall} />
      <Box p={[x0, H - 1.1, gate]} s={[0.4, 2.2, 4.4]} c={C.wall} />
      <Box p={[x0, H + 0.06, cz]} s={[0.5, 0.12, d + 0.4]} c={C.ink} />
      {/* восточная и южная стены срезаны, чтобы не закрывать линию */}
      <Box p={[x1, low / 2, (z0 + exit - 2.2) / 2]} s={[0.4, low, exit - 2.2 - z0]} c={C.wall} />
      <Box p={[x1, low / 2, (exit + 2.2 + z1) / 2]} s={[0.4, low, z1 - exit - 2.2]} c={C.wall} />
      <Box p={[cx, low / 2, z1]} s={[w + 0.4, low, 0.4]} c={C.wall} />
      <Box p={[cx, low + 0.05, z1]} s={[w + 0.5, 0.1, 0.5]} c={C.ink} />
      <Boxes items={inside} />

      {/* лаборатория геометрии: стеклянная комната с измерительной машиной */}
      <group position={[x1 - 12, 0, z0 + 2.6]}>
        <Box p={[0, 0.9, 2.1]} s={[8, 1.8, 0.06]} c={C.glass} o={0.3} />
        <Box p={[-4, 0.9, 0]} s={[0.06, 1.8, 4.2]} c={C.glass} o={0.3} />
        <Box p={[4, 0.9, 0]} s={[0.06, 1.8, 4.2]} c={C.glass} o={0.3} />
        <Box p={[0, 0.3, 0]} s={[3.4, 0.5, 1.9]} c="#3c434c" />
        <Box p={[0, 0.82, 0]} s={[1.7, 0.36, 0.8]} c="#8f98a3" />
        <Box p={[-0.1, 1.12, 0]} s={[0.9, 0.28, 0.7]} c="#8f98a3" />
        <Box p={[0.9, 1.3, -1.05]} s={[0.14, 1.6, 0.14]} c={G.white} />
        <Box p={[0.9, 1.3, 1.05]} s={[0.14, 1.6, 0.14]} c={G.white} />
        <Box p={[0.9, 2.1, 0]} s={[0.2, 0.18, 2.3]} c={G.white} />
        <Box p={[0.9, 1.75, 0.2]} s={[0.08, 0.6, 0.08]} c={C.bad} e={0.8} />
        <Box p={[-2.8, 0.5, -0.9]} s={[1.0, 1.0, 0.5]} c={C.light} />
      </group>
      {detail && <Label p={[x1 - 15.8, 2.5, z0 + 4.7]}>Лаборатория геометрии</Label>}
      {detail && <Label p={[x0 + 1.2, 1.6, z0 + 4.9]}>Склад штампованных деталей</Label>}

      <Tugger z={(ROWS[0] + ROWS[1]) / 2 - 0.65} x0={x0 + 4} x1={x1 - 6} speed={2.2} phase={0} />
      <Tugger z={(ROWS[1] + ROWS[2]) / 2 - 0.65} x0={x0 + 5} x1={x1 - 5} speed={1.8} phase={31} />
    </group>
  );
}

export function Site({ roof, detail }: { roof: boolean; detail: boolean }) {
  const decor = useMemo(() => {
    const r = rng(11);
    const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
    const containers: Item[] = [], cars: Item[] = [], cabins: Item[] = [], windows: Item[] = [], small: Item[] = [], flat: Item[] = [];

    const stack = (x: number, z: number, ew: boolean, lo: number, hi: number) => {
      const n = lo + Math.floor(r() * (hi - lo + 1));
      for (let s = 0; s < n; s++) containers.push({ p: [x, 0.6 + s * 1.12, z], s: ew ? [2.6, 1.08, 1.1] : [1.1, 1.08, 2.6], c: pick(BOXES) });
    };
    // контейнерная площадка: два ряда блоков по обе стороны железнодорожного тупика
    const row = (px0: number, px1: number, py: number, gaps: number) => {
      for (let x = wx(px0); x < wx(px1); x += 1.25) {
        if (r() < gaps) { x += 1.5; continue; }
        stack(x, wz(py) + 1.4, false, 1, 3);
        if (r() < 0.8) stack(x, wz(py) + 4.15, false, 1, 3);
      }
    };
    row(130, 240, 139, 0.14);
    row(110, 232, 192.5, 0.1);
    // три длинных штабеля у верхней дороги
    [[277, 28, 75], [291, 40, 82], [305, 30, 85]].forEach(([px, y0, y1]) => {
      for (let z = wz(y0); z < wz(y1); z += 1.2) stack(wx(px), z, true, 2, 4);
    });

    // машина на стоянке: кузов, крыша в цвет кузова и тёмные стёкла спереди и сзади
    const park = (x0: number, y0: number, x1: number, y1: number, fill: number, paints = FRESH, ew = false) => {
      const along = 1.5, across = 0.8;
      const [u0, u1, v0, v1] = ew ? [wx(x0), wx(x1), wz(y0), wz(y1)] : [wz(y0), wz(y1), wx(x0), wx(x1)];
      // ряды стоят парами нос к носу, между парами проезд
      for (let u = u0 + along / 2, row = 0; u < u1 - along / 2 + 0.01; u += along + (row % 2 ? 1.15 : 0.06), row++) {
        for (let v = v0 + across / 2; v < v1; v += across) {
          if (r() > fill) continue;
          const c = pick(paints), x = ew ? u : v, z = ew ? v : u;
          cars.push({ p: [x, 0.21, z], s: ew ? [1.3, 0.3, 0.62] : [0.62, 0.3, 1.3], c });
          cabins.push({ p: [x, 0.45, z], s: ew ? [0.66, 0.2, 0.56] : [0.56, 0.2, 0.66], c });
          for (const k of [-0.34, 0.34]) {
            windows.push({ p: ew ? [x + k, 0.44, z] : [x, 0.44, z + k], s: ew ? [0.05, 0.15, 0.5] : [0.5, 0.15, 0.05], c: GLASS });
          }
        }
      }
    };
    // зона таможенного контроля
    park(160, 75, 197, 101, 0.9);
    park(235, 68, 246, 103, 0.95);
    park(218, 22, 223, 36, 0.9);
    park(226, 25, 235, 46, 0.85);
    park(190, 24, 200, 34, 0.8);
    park(158, 62, 200, 71, 0.75);
    park(206, 78, 228, 101, 0.5);
    // верхняя площадка и стоянки готовых машин у северной стены корпуса
    park(379, 45, 394, 65, 0.7, PAINTS);
    park(389, 80, 397, 103, 0.8);
    park(333, 102, 341, 126, 0.95);
    park(355, 102, 364, 124, 0.6, PAINTS);
    park(302, 144, 326, 176, 0.95);
    park(283, 144, 290, 170, 0.9);
    park(374, 144, 412, 178, 0.95);
    park(425, 147, 431, 178, 0.8, ["#f4f4f0"]);
    // стоянка сотрудников и гостей, восточный проезд
    park(430, 62, 520, 70, 0.12, PAINTS);
    park(470, 112, 520, 120, 0.3, PAINTS);
    park(538, 205, 545, 330, 0.55, PAINTS);
    // юго-западная стоянка у ангаров
    park(28, 271, 94, 339, 0.88);
    park(39, 341, 87, 347, 0.7, FRESH, true);
    park(32, 373, 98, 380, 0.6, FRESH, true);

    // разметка стоянки с парковочными местами
    for (let px = 414; px <= 520; px += 15) {
      flat.push({ p: [wx(px), 0.06, wz(92)], s: [0.07, 0.02, 12.4], c: G.line });
      for (let z = wz(61); z <= wz(123); z += 1.05) flat.push({ p: [wx(px), 0.06, z], s: [2.0, 0.02, 0.06], c: G.line });
    }
    // поддоны с комплектующими у ангаров
    const pallets = (x0: number, y0: number, x1: number, y1: number) => {
      for (let x = wx(x0); x < wx(x1); x += 1.1) for (let z = wz(y0); z < wz(y1); z += 1.1) {
        if (r() < 0.25) continue;
        const h = 0.3 + Math.floor(r() * 3) * 0.32;
        small.push({ p: [x, h / 2 + 0.04, z], s: [0.9, h, 0.9], c: G.wood });
      }
    };
    pallets(170, 265, 187, 295);
    pallets(224, 288, 232, 297);
    pallets(150, 34, 166, 52);
    // зенитные фонари белого корпуса
    for (let k = 0; k < 8; k++) small.push({ p: [wx(146 + k * 9.6), 3.82, wz(317)], s: [0.25, 0.1, 5.2], c: "#c9ced2" });

    const sleepers: Item[] = [];
    const tracks = {
      main: strip(-42, 822, 90, -411), spur: strip(40, 180, 240, 180), spurN: strip(45, 123, 245, 123),
      curve1: strip(40, 180, 22, 198), curve2: strip(22, 198, 9, 232),
    };
    Object.values(tracks).forEach((tr) => {
      for (let t = 0.01; t < 1; t += 1.2 / tr.len) {
        const [x, z] = tr.at(t);
        sleepers.push({ p: [x, 0.05, z], s: [1.9, 0.08, 0.3], c: G.sleeper, ry: tr.ry + Math.PI / 2 });
      }
    });
    const flatcars = [0.453, 0.473, 0.493, 0.513, 0.533].map((t, i) => ({ p: tracks.main.at(t), c: BOXES[(i * 3) % 8] }));
    const train = Array.from({ length: 13 }, (_, i) => tracks.spur.at(0.14 + i * 0.066));
    const trees: [number, number, number][] = [];
    for (let i = 0; i < 16; i++) trees.push([wx(433 + r() * 30), wz(149 + r() * 26), 0.9 + r() * 0.5]);
    for (let i = 0; i < 6; i++) trees.push([wx(473 + r() * 34), wz(150 + r() * 22), 0.8 + r() * 0.4]);
    ([[10, 60], [70, 20], [240, 400], [300, 408], [565, 30], [575, 200], [572, 330], [34, 262], [-6, 352], [330, 14], [470, 30]] as V2[])
      .forEach(([x, y]) => trees.push([wx(x), wz(y), 0.9 + r() * 0.4]));
    return { containers, cars, cabins, windows, small, flat, sleepers, tracks, flatcars, train, trees };
  }, []);

  const roadTop = strip(-42, -56, 888, 130);
  const field = rect(510, 159, 524, 172);
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow><planeGeometry args={[2400, 2400]} /><meshStandardMaterial color={G.earth} roughness={1} /></mesh>

      {/* площадки */}
      <Flat r={rect(255, 128, 570, 404)} c={G.paved} />
      <Flat r={rect(100, 127, 252, 250)} c={G.concrete} y={0.03} />
      <Flat r={rect(45, 118, 252, 250)} c={G.paved} />
      <Flat r={rect(400, 48, 574, 132)} c={G.paved} />
      <Flat r={rect(126, 4, 264, 112)} c={G.paved} />
      <Flat r={rect(262, 18, 430, 128)} c={G.paved} />
      <Flat r={rect(20, 252, 250, 380)} c={G.paved} />
      <Flat r={rect(471, 146, 546, 178)} c={G.grass} y={0.05} />
      <Flat r={field} c={G.field} y={0.07} />
      {([[0, -field.d / 2, field.w, 0.08], [0, field.d / 2, field.w, 0.08], [-field.w / 2, 0, 0.08, field.d], [field.w / 2, 0, 0.08, field.d], [0, 0, 0.06, field.d]] as number[][]).map(([x, z, w, d], i) => (
        <mesh key={i} position={[field.cx + x, 0.1, field.cz + z]}><boxGeometry args={[w, 0.02, d]} /><meshBasicMaterial color={G.line} /></mesh>
      ))}

      {/* дороги */}
      <Flat r={rect(248, -400, 263, 900)} c={G.asphalt} y={0.06} />
      <Flat r={rect(-600, 383, 262, 396)} c={G.asphalt} y={0.06} />
      <Flat r={rect(546, 60, 563, 900)} c={G.asphalt} y={0.06} />
      <mesh position={[roadTop.pos[0], 0.07, roadTop.pos[2]]} rotation={[0, roadTop.ry, 0]} receiveShadow>
        <boxGeometry args={[roadTop.len, 0.04, 2.8]} /><meshStandardMaterial color={G.asphalt} roughness={0.95} />
      </mesh>
      <Box p={[wx(350), 0.3, wz(129)]} s={[31, 0.6, 0.5]} c={G.greyRoof} />

      {/* железная дорога: магистральный путь, тупик между рядами контейнеров, состав */}
      {Object.values(decor.tracks).map((tr, i) => <Track key={i} s={tr} />)}
      <Boxes items={decor.sleepers} shadow={false} />
      {decor.flatcars.map((wg, i) => (
        <group key={i} position={[wg.p[0], 0, wg.p[1]]} rotation={[0, decor.tracks.main.ry, 0]}>
          <Box p={[0, 0.42, 0]} s={[4.6, 0.2, 1.3]} c={C.ink} />
          <Box p={[-1.15, 1.08, 0]} s={[2.2, 1.1, 1.15]} c={wg.c} />
          <Box p={[1.15, 1.08, 0]} s={[2.2, 1.1, 1.15]} c={BOXES[(i * 5 + 2) % 8]} />
        </group>
      ))}
      {decor.train.map((p, i) => (i === 0 ? (
        <group key={i} position={[p[0], 0, p[1]]}>
          <Box p={[0, 0.85, 0]} s={[2.4, 1.2, 1.25]} c="#3d8f6a" />
          <Box p={[0.5, 1.6, 0]} s={[0.9, 0.5, 1.1]} c={C.yellow} />
        </group>
      ) : (
        <group key={i} position={[p[0], 0, p[1]]}>
          <Box p={[0, 0.3, 0]} s={[2.5, 0.16, 1.1]} c={C.ink} />
          <Box p={[0, 0.85, 0]} s={[2.4, 0.95, 1.2]} c={["#5a4a42", G.wagon, "#3f4f45", "#6b5548"][i % 4]} />
          <Box p={[0, 1.34, 0]} s={[2.2, 0.06, 1.0]} c="#23272d" />
        </group>
      )))}
      <Fence r={rect(45, 118, 252, 250)} />
      {[[60, 130], [245, 130], [60, 244], [245, 244], [150, 186]].map(([x, y]) => (
        <group key={`${x}${y}`} position={[wx(x), 0, wz(y)]}>
          <Box p={[0, 3.2, 0]} s={[0.14, 6.4, 0.14]} c={G.fence} />
          <Box p={[0, 6.4, 0]} s={[1.2, 0.14, 0.5]} c={C.light} e={0.4} />
        </group>
      ))}

      {/* зона таможенного контроля */}
      <Fence r={rect(126, 4, 264, 112)} />
      <Building r={rect(168, 15, 176, 23)} h={1.8} roof={G.white} />
      <Building r={rect(180, 17, 184, 26)} h={1.3} roof="#c9603f" />
      <Building r={rect(190, 21, 194, 29)} h={1.3} roof="#c9603f" />
      <Building r={rect(142, 46, 151, 57)} h={1.9} roof={G.blueRoof} />
      <Building r={rect(127, 78, 137, 96)} h={1.9} roof={G.greyRoof} />
      <Label p={[wx(200), 1.6, wz(8)]}>Зона таможенного контроля</Label>

      {/* главный корпус и пристройки */}
      <Hall detail={detail} />
      <Roof on={roof} />
      <Building r={rect(267, 168, 406, 184)} h={2.8} roof="#c3c8cb" />
      {Array.from({ length: 8 }, (_, k) => <Box key={k} p={[wx(277 + k * 17), 3.2, wz(176)]} s={[1.3, 0.4, 0.9]} c="#9aa1a6" />)}
      <Building r={rect(447, 162, 507, 184)} h={4.4} roof={G.roof} />
      <Box p={[wx(490), 4.7, wz(166)]} s={[5, 0.3, 1.6]} c={G.white} />
      <Building r={rect(379, 353, 521, 378)} h={3} roof={G.white} />
      <Building r={rect(300, 356, 335, 366)} h={1.7} roof={G.blueRoof} />
      <Building r={rect(529, 275, 536, 321)} h={1.8} roof={G.blueRoof} />
      <Box p={[wx(384), 0.35, wz(117)]} s={[6.8, 0.7, 0.2]} c={C.wall} />
      <Box p={[wx(384), 0.35, wz(103)]} s={[6.8, 0.7, 0.2]} c={C.wall} />
      <Flat r={rect(374, 106, 394, 116)} c={G.concrete} y={0.06} />

      {/* юго-западный участок: ангары, белый корпус, склад */}
      <Hangar r={rect(30, 351, 101, 368)} />
      <Hangar r={rect(114, 355, 187, 372)} />
      <Hangar r={rect(194, 268, 222, 283)} />
      <Building r={rect(135, 297, 221, 337)} h={3.6} roof={G.white} />
      <Building r={rect(125, 319, 135, 332)} h={2.4} roof={G.blueRoof} />
      <Building r={rect(153, 266, 163, 288)} h={2.2} roof={G.white} />
      <Building r={rect(24, 315, 31, 338)} h={1.6} roof={G.blueRoof} />
      {[0, 1, 2, 3, 4].map((k) => <Truck key={k} p={[wx(138 + k * 11), 0, wz(346)]} rot={Math.PI / 2} cargo={BOXES[(k * 3 + 1) % 8]} cab={k % 2 ? "#c0392b" : C.truck} />)}
      {[0, 1, 2].map((k) => <Truck key={k} p={[wx(202 + k * 12), 0, wz(376)]} rot={Math.PI / 2} cargo={k === 1 ? "#5c7a99" : G.white} cab="#55606b" />)}

      <Boxes items={decor.containers} />
      <Boxes items={decor.cars} />
      <Boxes items={decor.cabins} shadow={false} />
      <Boxes items={decor.windows} shadow={false} />
      <Boxes items={decor.small} />
      <Boxes items={decor.flat} shadow={false} />

      <Truck p={[-60, 0, ROWS[0]]} rot={0} cargo="#f4f4f0" />
      <Truck p={[-13.5, 0, -29.3]} rot={Math.PI} cargo={C.steel} />
      <Truck p={[wx(256), 0, wz(300)]} rot={Math.PI / 2} cargo="#b5533c" />
      <Truck p={[wx(514), 0, wz(81)]} rot={0} cargo={G.white} cab={G.white} />
      {decor.trees.map(([x, z, s], i) => <Tree key={i} p={[x, z]} s={s} />)}
    </group>
  );
}
