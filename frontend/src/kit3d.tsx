import { useLayoutEffect, useRef } from "react";
import * as THREE from "three";

export type V2 = [number, number];
export type V3 = [number, number, number];

// Палитра сцены повторяет токены интерфейса (styles.css), переведённые в sRGB.
export const C = {
  slab: "#f1f4f1", wall: "#c5cfcb", ink: "#1d2533", steel: "#aeb6bf",
  light: "#e9edee", yellow: "#efb321", ok: "#2f9e5b", warn: "#c98a1e", bad: "#d23b2e", idle: "#6f7785",
  planned: "#4a78c2", ai: "#7a35c9", glass: "#bfe0f5", teal: "#6fc7bd", oven: "#f0a465", tree: "#63ad7b",
  trunk: "#8a6f55", truck: "#2f62c9", skin: "#e8c39e", overall: "#35507a",
};
export const PAINTS = ["#c0392b", "#1f4e9c", "#f4f4f0", "#2b2f36", "#3d8f6a", "#d9a21b"];
export const GLASS = "#27303d";

export function Box({ p, s, c, r, o, e }: { p: V3; s: V3; c: string; r?: V3; o?: number; e?: number }) {
  return (
    <mesh position={p} rotation={r} castShadow={o == null} receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} transparent={o != null} opacity={o ?? 1} depthWrite={o == null}
        emissive={e ? c : "#000000"} emissiveIntensity={e ?? 0} roughness={0.75} />
    </mesh>
  );
}

export interface Item { p: V3; s: V3; c: string; ry?: number }

/** Много однотипных коробок одним вызовом отрисовки (контейнеры, машины, шпалы). */
export function Boxes({ items, shadow = true, material }: { items: Item[]; shadow?: boolean; material?: THREE.Material }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), col = new THREE.Color();
    const pos = new THREE.Vector3(), scl = new THREE.Vector3();
    items.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.ry ?? 0, 0));
      m.compose(pos.set(...it.p), q, scl.set(...it.s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(it.c));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [items]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow={shadow} receiveShadow frustumCulled={false}
      {...(material ? { material } : {})}>
      <boxGeometry />
      {!material && <meshStandardMaterial roughness={0.8} />}
    </instancedMesh>
  );
}
