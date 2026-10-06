import { useFrame } from "@react-three/fiber";
import { ReactNode, useRef } from "react";
import * as THREE from "three";
import { Box, C, GLASS, V2, V3 } from "./kit3d";

/**
 * Оборудование постов. Линия идёт вдоль оси X через начало координат поста,
 * кузов проходит на высоте 0,2–1,0. Состав оборудования повторяет реальную
 * последовательность операций завода: сварка, ванны и окраска, сборка, испытания.
 */
const WHITE = "#eef0ee", WOOD = "#c9a36b", TIRE = "#14181f", ORANGE = "#e8641b";
// направления разлёта искр: веер вверх и в стороны от точки сварки
const SPARK_DIRS: V3[] = [[0.9, 0.7, 0.2], [-0.8, 0.9, 0.1], [0.3, 1.0, 0.8], [-0.4, 0.6, -0.9], [0.7, 0.4, -0.6], [-0.9, 0.5, 0.6], [0.1, 1.1, -0.3], [0.5, 0.8, 0.9], [-0.6, 1.0, -0.5], [0.95, 0.3, -0.1]];
interface P { running: boolean; phase: number }

export function Worker({ p, c = C.overall }: { p: V3; c?: string }) {
  return (
    <group position={p}>
      <mesh position={[0, 0.3, 0]} castShadow><capsuleGeometry args={[0.12, 0.3, 4, 8]} /><meshStandardMaterial color={c} /></mesh>
      <mesh position={[0, 0.68, 0]} castShadow><sphereGeometry args={[0.1, 10, 10]} /><meshStandardMaterial color={C.skin} /></mesh>
      <mesh position={[0, 0.76, 0]}><sphereGeometry args={[0.105, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color={C.yellow} /></mesh>
    </group>
  );
}

/**
 * Шестиосевой робот: основание, два звена, инструмент. Смотрит на линию (+Z в своих координатах).
 * sparks: сварочный робот, из точки сварки летят искры; иначе на инструменте облачко краски.
 */
function Robot({ running, phase, at, flip, color = C.yellow, tip = "#fff1a8", scale = 1, sparks }: P & { at: V2; flip?: boolean; color?: string; tip?: string; scale?: number; sparks?: boolean }) {
  const arm = useRef<THREE.Group>(null);
  const fx = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (arm.current && running) arm.current.rotation.y = Math.sin(t * 1.6 + phase) * 0.5;
    const g = fx.current;
    if (!g) return;
    // сварка идёт сериями: вспышка и веер искр, затем пауза на перенос инструмента
    const welding = running && (sparks ? Math.sin(t * 2.3 + phase) > -0.2 : Math.sin(t * 23 + phase) > 0.1);
    g.visible = welding;
    if (!welding || !sparks) return;
    g.children.forEach((sp, i) => {
      if (i === 0) { sp.scale.setScalar(0.7 + 0.5 * Math.sin(t * 40 + i)); return; }
      const d = SPARK_DIRS[(i - 1) % SPARK_DIRS.length];
      const life = (t * 2.6 + i * 0.137 + phase) % 1;
      sp.position.set(d[0] * life * 1.3, d[1] * life * 1.3 - life * life * 1.4, d[2] * life * 1.3);
      sp.scale.setScalar(1 - life * 0.8);
    });
  });
  return (
    <group position={[at[0], 0, at[1]]} rotation={[0, flip ? Math.PI : 0, 0]} scale={scale}>
      <Box p={[0, 0.15, 0]} s={[0.7, 0.3, 0.7]} c={C.ink} />
      <group ref={arm} position={[0, 0.3, 0]}>
        <Box p={[0, 0.52, 0.16]} s={[0.22, 1.1, 0.22]} c={color} r={[0.3, 0, 0]} />
        <Box p={[0, 0.89, 0.79]} s={[0.17, 1.0, 0.17]} c={color} r={[1.9, 0, 0]} />
        <Box p={[0, 1.05, 0.32]} s={[0.3, 0.3, 0.3]} c={C.ink} />
        <Box p={[0, 0.74, 1.22]} s={[0.12, 0.2, 0.2]} c={C.ink} />
        <group ref={fx} position={[0, 0.72, 1.3]}>
          <mesh>
            <sphereGeometry args={[sparks ? 0.12 : 0.1, 10, 10]} /><meshBasicMaterial color={sparks ? "#ffffff" : tip} />
            {sparks && <mesh><sphereGeometry args={[0.32, 12, 12]} /><meshBasicMaterial color="#ffd27a" transparent opacity={0.35} depthWrite={false} /></mesh>}
          </mesh>
          {sparks && Array.from({ length: 20 }, (_, i) => (
            <mesh key={i}><boxGeometry args={[0.07, 0.07, 0.07]} /><meshBasicMaterial color={i % 3 ? "#ffa52e" : "#fff1a8"} /></mesh>
          ))}
        </group>
      </group>
    </group>
  );
}

function Portal({ x = 0, h = 2.0, half = 1.25, c = C.steel, e }: { x?: number; h?: number; half?: number; c?: string; e?: number }) {
  return (
    <group position={[x, 0, 0]}>
      <Box p={[0, h / 2, -half]} s={[0.14, h, 0.14]} c={c} e={e} />
      <Box p={[0, h / 2, half]} s={[0.14, h, 0.14]} c={c} e={e} />
      <Box p={[0, h, 0]} s={[0.16, 0.14, half * 2 + 0.14]} c={c} e={e} />
    </group>
  );
}

/** Тара с панелями кузова. */
function Stillage({ p, n = 5 }: { p: V3; n?: number }) {
  return (
    <group position={p}>
      <Box p={[0, 0.1, 0]} s={[1.3, 0.12, 0.9]} c={C.ink} />
      <Box p={[-0.62, 0.55, 0]} s={[0.06, 0.9, 0.9]} c={C.ink} />
      <Box p={[0.62, 0.55, 0]} s={[0.06, 0.9, 0.9]} c={C.ink} />
      {Array.from({ length: n }, (_, k) => <Box key={k} p={[-0.42 + k * 0.2, 0.58, 0]} s={[0.05, 0.8, 0.78]} c="#8f98a3" />)}
    </group>
  );
}

function Forklift({ p, ry = 0 }: { p: V3; ry?: number }) {
  return (
    <group position={p} rotation={[0, ry, 0]}>
      <Box p={[0, 0.32, 0]} s={[0.8, 0.4, 0.5]} c={C.yellow} />
      <Box p={[-0.1, 0.72, 0]} s={[0.4, 0.4, 0.46]} c={C.ink} o={0.5} />
      <Box p={[0.45, 0.6, 0]} s={[0.07, 1.1, 0.4]} c={C.ink} />
      <Box p={[0.7, 0.12, 0]} s={[0.5, 0.04, 0.34]} c={C.steel} />
    </group>
  );
}

function Booth({ len = 2.9, tint, children }: { len?: number; tint: string; children?: ReactNode }) {
  const hx = len / 2 - 0.15;
  return (
    <group>
      {([[-hx, -1.05], [hx, -1.05], [-hx, 1.05], [hx, 1.05]] as V2[]).map(([x, z]) => <Box key={`${x}${z}`} p={[x, 0.9, z]} s={[0.12, 1.8, 0.12]} c={C.ink} />)}
      <Box p={[0, 1.86, 0]} s={[len, 0.12, 2.4]} c={C.light} />
      <Box p={[0, 0.95, -1.05]} s={[len - 0.4, 1.6, 0.04]} c={tint} o={0.4} />
      <Box p={[0, 0.95, 1.05]} s={[len - 0.4, 1.6, 0.04]} c={tint} o={0.2} />
      <mesh position={[len / 2 - 0.6, 2.3, -0.6]} castShadow><cylinderGeometry args={[0.16, 0.16, 0.8, 12]} /><meshStandardMaterial color={C.steel} /></mesh>
      {children}
    </group>
  );
}

// --- логистика -----------------------------------------------------------
function Yard() {
  return (
    <group>
      {/* ричстакер держит контейнер на стреле */}
      <group position={[0.2, 0, 2.4]} rotation={[0, 0.25, 0]}>
        <Box p={[0, 0.6, 0]} s={[2.0, 0.6, 1.1]} c={C.yellow} />
        <Box p={[-0.5, 1.15, 0]} s={[0.7, 0.5, 0.9]} c={GLASS} o={0.6} />
        <Box p={[0.35, 1.55, 0]} s={[2.6, 0.22, 0.3]} c={C.yellow} r={[0, 0, 0.42]} />
        <Box p={[1.55, 1.7, 0]} s={[0.2, 0.2, 2.5]} c={C.ink} />
        <Box p={[1.55, 1.1, 0]} s={[1.1, 1.0, 2.5]} c="#2f62c9" />
        {([[0.7, 0.6], [0.7, -0.6], [-0.7, 0.6], [-0.7, -0.6]] as V2[]).map(([x, z]) => (
          <mesh key={`${x}${z}`} position={[x, 0.32, z]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.32, 0.32, 0.25, 14]} /><meshStandardMaterial color={TIRE} /></mesh>
        ))}
      </group>
      <Worker p={[-0.9, 0, 1.4]} c="#d9822b" />
    </group>
  );
}

function Unpack() {
  return (
    <group>
      {([[-1.7, -1.4], [1.7, -1.4], [-1.7, 1.4], [1.7, 1.4]] as V2[]).map(([x, z]) => <Box key={`${x}${z}`} p={[x, 1.2, z]} s={[0.14, 2.4, 0.14]} c={C.steel} />)}
      <Box p={[0, 2.45, 0]} s={[3.8, 0.1, 3.2]} c={C.light} o={0.75} />
      {/* вскрытый контейнер и ящики с деталями комплекта */}
      <Box p={[-0.2, 0.6, -2.0]} s={[2.6, 1.08, 1.1]} c="#5c7a99" />
      <Box p={[1.15, 0.6, -2.0]} s={[0.06, 1.0, 1.0]} c={C.ink} r={[0, 0.9, 0]} />
      {([[-1.0, 0.3, 1.0], [-0.1, 0.3, 1.0], [-0.55, 0.9, 1.0], [0.9, 0.3, 1.05]] as V3[]).map((p, i) => <Box key={i} p={[p[0], p[1], p[2] + 1.2]} s={[0.8, 0.6, 0.7]} c={WOOD} />)}
      <Forklift p={[1.5, 0, 2.1]} ry={Math.PI} />
      <Worker p={[-0.6, 0, 0.95]} c="#d9822b" />
      <Worker p={[0.7, 0, -0.95]} c="#d9822b" />
    </group>
  );
}

// --- сварка --------------------------------------------------------------
function WeldFloor(p: P) {
  return (
    <group>
      {([[-0.9, -0.62], [0.9, -0.62], [-0.9, 0.62], [0.9, 0.62]] as V2[]).map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 0, z]}><Box p={[0, 0.2, 0]} s={[0.14, 0.4, 0.14]} c={C.ink} /><Box p={[0, 0.45, 0]} s={[0.2, 0.1, 0.2]} c={C.yellow} /></group>
      ))}
      <Robot {...p} at={[-0.7, -1.55]} color={ORANGE} sparks />
      <Robot {...p} phase={p.phase + 2} at={[0.7, 1.55]} flip color={ORANGE} sparks />
      <Stillage p={[1.5, 0, -2.5]} />
      <Worker p={[0.9, 0, -1.0]} />
      <Box p={[-1.95, 0.8, -1.6]} s={[0.05, 1.6, 1.5]} c="#7a2b22" o={0.55} />
      <Box p={[-1.95, 0.8, 1.6]} s={[0.05, 1.6, 1.5]} c="#7a2b22" o={0.55} />
    </group>
  );
}

function WeldSide(p: P) {
  return (
    <group>
      {[-1.2, 1.2].map((z) => (
        <group key={z} position={[0, 0, z]} rotation={[z < 0 ? -0.18 : 0.18, 0, 0]}>
          <Box p={[0, 0.75, 0]} s={[2.1, 0.08, 0.08]} c={C.ink} />
          <Box p={[0, 1.6, 0]} s={[2.1, 0.08, 0.08]} c={C.ink} />
          <Box p={[-1.05, 1.0, 0]} s={[0.08, 1.3, 0.08]} c={C.ink} />
          <Box p={[1.05, 1.0, 0]} s={[0.08, 1.3, 0.08]} c={C.ink} />
          <Box p={[0, 1.17, 0]} s={[1.8, 0.7, 0.04]} c="#8f98a3" />
        </group>
      ))}
      <Robot {...p} at={[-1.55, -2.0]} color={ORANGE} sparks />
      <Robot {...p} phase={p.phase + 2} at={[1.55, 2.0]} flip color={ORANGE} sparks />
      <Stillage p={[1.5, 0, -2.6]} n={4} />
    </group>
  );
}

function Framing(p: P) {
  const laser = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const m = laser.current;
    if (!m) return;
    m.visible = p.running && Math.sin(clock.elapsedTime * 1.7 + p.phase) > 0;
    m.position.x = Math.sin(clock.elapsedTime * 0.9 + p.phase) * 0.45;
  });
  return (
    <group>
      <Box p={[0, 2.3, 0]} s={[1.2, 0.16, 0.3]} c={C.ink} />
      <mesh ref={laser} position={[0, 1.62, 0]}>
        <boxGeometry args={[0.06, 1.25, 0.06]} /><meshBasicMaterial color="#7ef0ff" />
        <mesh position={[0, -0.62, 0]}><sphereGeometry args={[0.2, 12, 12]} /><meshBasicMaterial color="#c9fbff" transparent opacity={0.7} depthWrite={false} /></mesh>
      </mesh>
      {([[-1.5, -1.25], [1.5, -1.25], [-1.5, 1.25], [1.5, 1.25]] as V2[]).map(([x, z]) => <Box key={`${x}${z}`} p={[x, 1.25, z]} s={[0.2, 2.5, 0.2]} c={C.ink} />)}
      <Box p={[0, 2.5, -1.25]} s={[3.2, 0.2, 0.2]} c={C.yellow} />
      <Box p={[0, 2.5, 1.25]} s={[3.2, 0.2, 0.2]} c={C.yellow} />
      <Box p={[-1.5, 2.5, 0]} s={[0.2, 0.2, 2.5]} c={C.yellow} />
      <Box p={[1.5, 2.5, 0]} s={[0.2, 0.2, 2.5]} c={C.yellow} />
      {([[-0.8, -0.55], [0.8, -0.55], [-0.8, 0.55], [0.8, 0.55]] as V2[]).map(([x, z]) => <Box key={`${x}${z}`} p={[x, 1.75, z]} s={[0.1, 1.4, 0.1]} c={C.steel} />)}
      <Robot {...p} at={[-0.75, -1.7]} scale={0.85} color={ORANGE} sparks />
      <Robot {...p} phase={p.phase + 1} at={[0.75, -1.7]} scale={0.85} color={ORANGE} sparks />
      <Robot {...p} phase={p.phase + 2} at={[-0.75, 1.7]} flip scale={0.85} color={ORANGE} sparks />
      <Robot {...p} phase={p.phase + 3} at={[0.75, 1.7]} flip scale={0.85} color={ORANGE} sparks />
    </group>
  );
}

function MetalFinish({ running, phase }: P) {
  const beams = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (beams.current) beams.current.visible = running && Math.sin(clock.elapsedTime * 5 + phase) > -0.6; });
  return (
    <group>
      <Worker p={[-1.7, 0, -0.95]} />
      <Worker p={[-1.0, 0, 0.95]} />
      {/* лазерный замер геометрии: стойки с датчиками и лучи поперёк кузова */}
      {[0.2, 1.3].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <Box p={[0, 0.8, -1.2]} s={[0.12, 1.6, 0.12]} c={C.planned} />
          <Box p={[0, 0.8, 1.2]} s={[0.12, 1.6, 0.12]} c={C.planned} />
          <Box p={[0, 1.6, 0]} s={[0.12, 0.1, 2.5]} c={C.planned} />
        </group>
      ))}
      <group ref={beams}>
        {[0.45, 0.75, 1.05].map((y) => [0.2, 1.3].map((x) => (
          <mesh key={`${x}${y}`} position={[x, y, 0]}><boxGeometry args={[0.025, 0.025, 2.3]} /><meshBasicMaterial color="#ff3b30" /></mesh>
        )))}
      </group>
      <Box p={[1.9, 0.55, -1.7]} s={[0.5, 1.1, 0.4]} c={C.light} />
      <Box p={[1.9, 0.85, -1.49]} s={[0.36, 0.26, 0.02]} c={C.ok} e={0.8} />
    </group>
  );
}

// --- окраска -------------------------------------------------------------
function Baths() {
  const liquids = [C.teal, "#8fb7a8", "#b9cbd8", "#b9cbd8", "#3e4650"];
  return (
    <group>
      {liquids.map((c, i) => (
        <group key={i} position={[-2.0 + i * 1.0, 0, 0]}>
          <Box p={[0, 0.3, -0.98]} s={[0.92, 0.6, 0.08]} c={C.steel} />
          <Box p={[0, 0.3, 0.98]} s={[0.92, 0.6, 0.08]} c={C.steel} />
          <Box p={[0, 0.27, 0]} s={[0.92, 0.42, 1.88]} c={c} o={0.72} />
        </group>
      ))}
      {[-2.3, 0, 2.3].map((x) => <Portal key={x} x={x} h={2.3} />)}
      <Box p={[0, 2.3, 0]} s={[4.9, 0.14, 0.2]} c={C.ink} />
      <mesh position={[1.9, 0.6, -1.9]} castShadow><cylinderGeometry args={[0.4, 0.4, 1.2, 16]} /><meshStandardMaterial color={C.steel} /></mesh>
      <mesh position={[0.9, 0.6, -1.9]} castShadow><cylinderGeometry args={[0.4, 0.4, 1.2, 16]} /><meshStandardMaterial color={C.steel} /></mesh>
    </group>
  );
}

function Primer(p: P) {
  return (
    <Booth tint={C.glass}>
      <Robot {...p} at={[-0.5, -0.95]} color={WHITE} tip="#dfe6ea" scale={0.62} />
      <Robot {...p} phase={p.phase + 2} at={[0.5, 0.95]} flip color={WHITE} tip="#dfe6ea" scale={0.62} />
    </Booth>
  );
}

function Topcoat(p: P) {
  return (
    <Booth tint={C.glass} len={3.8}>
      <Robot {...p} at={[-1.0, -0.95]} color={WHITE} tip="#ff8a7a" scale={0.62} />
      <Robot {...p} phase={p.phase + 1} at={[0.9, -0.95]} color={WHITE} tip="#ffe9a8" scale={0.62} />
      <Robot {...p} phase={p.phase + 2} at={[-0.9, 0.95]} flip color={WHITE} tip="#ff8a7a" scale={0.62} />
      <Robot {...p} phase={p.phase + 3} at={[1.0, 0.95]} flip color={WHITE} tip="#ffe9a8" scale={0.62} />
      <Box p={[0, 1.74, 0]} s={[3.2, 0.05, 1.6]} c="#ffffff" e={0.6} />
    </Booth>
  );
}

function Oven() {
  return (
    <group>
      {/* закрытый тоннель печи: кузов въезжает в светящийся проём и выезжает с другой стороны */}
      <Box p={[0, 1.0, 0]} s={[3.4, 1.9, 2.2]} c="#b9c0c6" />
      <Box p={[0, 2.0, 0]} s={[3.6, 0.14, 2.4]} c={C.ink} />
      {[-1.72, 1.72].map((x) => <Box key={x} p={[x, 0.78, 0]} s={[0.04, 1.2, 1.5]} c={C.oven} e={1.6} />)}
      {[-1.1, -0.35, 0.4, 1.15].map((x) => <Box key={x} p={[x, 1.15, 1.11]} s={[0.5, 0.3, 0.03]} c={C.oven} e={1.3} />)}
      <Box p={[0, 0.5, 1.11]} s={[3.2, 0.06, 0.03]} c={C.ink} />
      {[-1.1, 1.1].map((x) => <mesh key={x} position={[x, 2.65, -0.6]} castShadow><cylinderGeometry args={[0.2, 0.2, 1.2, 12]} /><meshStandardMaterial color={C.steel} /></mesh>)}
    </group>
  );
}

/** ИИ-контроль покрытия: рамки с камерами и полоса сканирования вдоль кузова. */
function AiScan({ running, phase }: P) {
  const scan = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!scan.current) return;
    scan.current.visible = running;
    scan.current.position.x = Math.sin(clock.elapsedTime * 1.4 + phase) * 1.1;
  });
  return (
    <group>
      {[-1.3, 1.3].map((x) => (
        <group key={x} position={[x, 0, 0]}>
          <Portal h={1.9} half={1.15} c={C.ink} />
          {([[-1.0, 1.1], [-1.0, 0.6], [1.0, 1.1], [1.0, 0.6], [0, 1.78]] as V2[]).map(([z, y]) => (
            <group key={`${z}${y}`} position={[0, y, z]}>
              <Box p={[0, 0, 0]} s={[0.32, 0.22, 0.22]} c={C.ink} />
              <Box p={[x < 0 ? 0.18 : -0.18, 0, 0]} s={[0.05, 0.13, 0.13]} c={C.ai} e={1.6} />
            </group>
          ))}
        </group>
      ))}
      <mesh ref={scan} position={[0, 0.95, 0]}><boxGeometry args={[0.1, 1.6, 2.1]} /><meshBasicMaterial color={C.ai} transparent opacity={0.5} depthWrite={false} /></mesh>
      <Box p={[1.9, 0.55, -1.7]} s={[0.5, 1.1, 0.4]} c={C.light} />
      <Box p={[1.9, 0.9, -1.49]} s={[0.4, 0.3, 0.02]} c={C.ai} e={0.9} />
      <Worker p={[1.3, 0, -1.5]} c="#55606b" />
    </group>
  );
}

// --- сборка --------------------------------------------------------------
function FlowRack({ p }: { p: V3 }) {
  const bins = ["#2f62c9", "#d9822b", "#2f9e5b", "#c0392b", "#55606b"];
  return (
    <group position={p}>
      {[-0.75, 0.75].map((x) => <Box key={x} p={[x, 0.7, 0]} s={[0.06, 1.4, 0.5]} c={C.ink} />)}
      {[0.35, 0.8, 1.25].map((y, j) => (
        <group key={y}>
          <Box p={[0, y, 0]} s={[1.5, 0.04, 0.5]} c={C.steel} />
          {[-0.5, 0, 0.5].map((x, i) => <Box key={x} p={[x, y + 0.15, 0]} s={[0.4, 0.24, 0.4]} c={bins[(i + j * 2) % bins.length]} />)}
        </group>
      ))}
    </group>
  );
}

function Trim() {
  return (
    <group>
      <FlowRack p={[-0.9, 0, -1.9]} />
      <FlowRack p={[0.9, 0, 1.9]} />
      <Box p={[1.2, 0.45, -1.6]} s={[1.2, 0.3, 0.4]} c={C.ink} />
      <Box p={[1.2, 0.2, -1.6]} s={[1.0, 0.1, 0.5]} c={C.steel} />
      <Worker p={[-0.9, 0, -0.95]} />
      <Worker p={[0.3, 0, -0.95]} />
      <Worker p={[-0.2, 0, 0.95]} />
    </group>
  );
}

function Chassis({ running, phase }: P) {
  const hook = useRef<THREE.Group>(null);
  useFrame(({ clock }) => { if (hook.current && running) hook.current.position.y = Math.sin(clock.elapsedTime * 1.5 + phase) * 0.12; });
  return (
    <group>
      <Portal x={-1.9} h={2.5} c={C.ink} />
      <Portal x={1.9} h={2.5} c={C.ink} />
      <Box p={[0, 2.5, 0]} s={[4.0, 0.16, 0.24]} c={C.yellow} />
      <group ref={hook}>
        {[-0.7, 0.7].map((x) => (
          <group key={x} position={[x, 0, 0]}>
            <Box p={[0, 1.85, 0]} s={[0.08, 1.2, 0.08]} c={C.steel} />
            <Box p={[0, 1.25, 0]} s={[0.1, 0.08, 1.1]} c={C.steel} />
          </group>
        ))}
      </group>
      <Box p={[1.1, 0.3, -1.8]} s={[0.9, 0.12, 0.7]} c={WOOD} />
      <Box p={[1.1, 0.6, -1.8]} s={[0.6, 0.45, 0.45]} c="#3c434c" />
      <Worker p={[-0.5, 0, -0.95]} />
      <Worker p={[0.6, 0, 0.95]} />
    </group>
  );
}

function Marriage({ running, phase }: P) {
  const lift = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (lift.current && running) lift.current.position.z = -1.35 + (Math.sin(clock.elapsedTime * 1.2 + phase) * 0.5 + 0.5) * 0.5;
  });
  return (
    <group>
      {/* тележка с двигателем и мостом подаётся под кузов */}
      <group ref={lift} position={[0, 0, -1.35]}>
        <Box p={[0, 0.14, 0]} s={[1.5, 0.16, 0.8]} c={C.yellow} />
        <Box p={[0.35, 0.45, 0]} s={[0.55, 0.45, 0.5]} c="#3c434c" />
        <Box p={[0.35, 0.72, 0]} s={[0.4, 0.1, 0.36]} c={C.steel} />
        <mesh position={[-0.45, 0.36, 0]} rotation={[Math.PI / 2, 0, 0]} castShadow><cylinderGeometry args={[0.07, 0.07, 0.95, 10]} /><meshStandardMaterial color={C.steel} /></mesh>
      </group>
      <Robot running={running} phase={phase} at={[1.2, 1.6]} flip />
      <Portal x={-1.3} h={2.2} c={C.ink} />
      <Worker p={[-0.4, 0, 0.95]} />
      <Worker p={[0.9, 0, -2.0]} />
    </group>
  );
}

function Final() {
  return (
    <group>
      {[-1.6, -1.05, -0.5].map((x, i) => Array.from({ length: 4 - i % 2 }, (_, k) => (
        <mesh key={`${x}${k}`} position={[x, 0.1 + k * 0.2, -1.9]} castShadow><cylinderGeometry args={[0.24, 0.24, 0.18, 16]} /><meshStandardMaterial color={TIRE} /></mesh>
      )))}
      {/* пост заправки жидкостей */}
      <Box p={[1.1, 0.1, -1.9]} s={[1.4, 0.2, 0.5]} c={C.ink} />
      {[["#2f62c9", 0.65], ["#2f9e5b", 1.1], ["#d9822b", 1.55]].map(([c, x]) => (
        <mesh key={x} position={[x as number, 0.7, -1.9]} castShadow><cylinderGeometry args={[0.17, 0.17, 1.0, 14]} /><meshStandardMaterial color={c as string} /></mesh>
      ))}
      <Box p={[1.1, 1.35, -1.9]} s={[1.4, 0.08, 0.3]} c={C.steel} />
      <Box p={[-0.6, 0.35, 1.9]} s={[0.5, 0.35, 0.5]} c="#55606b" />
      <Box p={[-0.6, 0.65, 2.1]} s={[0.5, 0.5, 0.12]} c="#55606b" />
      <Box p={[0.1, 0.35, 1.9]} s={[0.5, 0.35, 0.5]} c="#55606b" />
      <Box p={[0.1, 0.65, 2.1]} s={[0.5, 0.5, 0.12]} c="#55606b" />
      <Worker p={[-0.9, 0, -0.95]} />
      <Worker p={[0.5, 0, 0.95]} />
    </group>
  );
}

// --- испытания -----------------------------------------------------------
function Rollers() {
  return (
    <group>
      {([[-0.55, -0.32], [0.55, -0.32], [-0.55, 0.32], [0.55, 0.32]] as V2[]).map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.17, z]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.12, 0.12, 0.34, 14]} /><meshStandardMaterial color={C.steel} metalness={0.6} roughness={0.3} /></mesh>
      ))}
      {[-1.2, 1.2].map((x) => (
        <group key={x} position={[x, 0, -1.5]}>
          <Box p={[0, 0.7, 0]} s={[0.1, 1.4, 0.1]} c={C.planned} />
          <Box p={[0, 1.3, 0.06]} s={[0.5, 0.36, 0.05]} c={GLASS} />
          <Box p={[0, 1.3, 0.09]} s={[0.4, 0.26, 0.02]} c={C.ok} e={0.9} />
        </group>
      ))}
      <Box p={[1.85, 0.5, 0.9]} s={[0.3, 1.0, 0.3]} c={C.light} />
      <Box p={[1.7, 0.6, 0.9]} s={[0.04, 0.3, 0.3]} c="#fff1a8" e={1.2} />
      <Worker p={[-0.3, 0, -1.2]} />
    </group>
  );
}

function Shower({ running, phase }: P) {
  const drops = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = drops.current;
    if (!g) return;
    g.visible = running;
    g.children.forEach((d, i) => { d.position.y = 1.6 - ((clock.elapsedTime * 2.6 + i * 0.37 + phase) % 1.3); });
  });
  return (
    <Booth tint="#8fc3ee">
      <group ref={drops}>
        {Array.from({ length: 18 }, (_, i) => (
          <mesh key={i} position={[-1.1 + (i % 6) * 0.44, 1.2, -0.7 + Math.floor(i / 6) * 0.7]}><boxGeometry args={[0.03, 0.3, 0.03]} /><meshBasicMaterial color="#5aa9e6" /></mesh>
        ))}
      </group>
      <Box p={[0, 1.7, -0.7]} s={[2.4, 0.06, 0.06]} c={C.planned} />
      <Box p={[0, 1.7, 0]} s={[2.4, 0.06, 0.06]} c={C.planned} />
      <Box p={[0, 1.7, 0.7]} s={[2.4, 0.06, 0.06]} c={C.planned} />
      <Box p={[0, 0.08, 0]} s={[2.6, 0.04, 1.9]} c="#8fc3ee" o={0.45} />
    </Booth>
  );
}

function LightTunnel() {
  return (
    <group>
      {[-1.6, -0.8, 0, 0.8, 1.6].map((x) => <Portal key={x} x={x} h={2.0} half={1.15} c="#ffffff" e={1.1} />)}
      <Worker p={[-0.4, 0, -0.9]} c="#55606b" />
      <Worker p={[0.5, 0, 0.9]} c="#55606b" />
    </group>
  );
}

function Dispatch() {
  return (
    <group>
      <Portal x={0} h={2.4} half={1.3} c={C.ink} />
      <Box p={[0, 2.4, 0]} s={[0.2, 0.2, 2.74]} c={C.yellow} />
      <Box p={[0.15, 2.05, -0.5]} s={[0.1, 0.3, 0.3]} c={C.ok} e={1.2} />
      <Box p={[-1.4, 0.7, 1.9]} s={[1.0, 1.4, 0.9]} c={C.light} />
      <Box p={[-1.4, 1.0, 1.44]} s={[0.7, 0.5, 0.03]} c={GLASS} />
      <Worker p={[-0.4, 0, 1.3]} c="#55606b" />
    </group>
  );
}

const RIGS: Record<string, (p: P) => ReactNode> = {
  yard: Yard, unpack: Unpack, weld_floor: WeldFloor, weld_side: WeldSide, framing: Framing, metalfinish: MetalFinish,
  baths: Baths, primer: Primer, topcoat: Topcoat, oven: Oven, aiscan: AiScan, trim: Trim, chassis: Chassis, marriage: Marriage,
  final: Final, rollers: Rollers, shower: Shower, lighttunnel: LightTunnel, dispatch: Dispatch,
};

export function Rig({ rig, running, phase }: P & { rig?: string }) {
  const Comp = (rig && RIGS[rig]) || Trim;
  return <Comp running={running} phase={phase} />;
}
