"use client";

/**
 * Ticket S2-12 — the R3F "3D-lite" crate twins, one box per *lot* (not per node), driven by
 * `Topics.allLots`. Loaded only via `next/dynamic({ ssr: false })` from TwinsDashboard.tsx.
 *
 * Deliberately no `@react-three/drei`: the ticket only needs a slowly auto-rotating static
 * camera and colored boxes, both trivial to hand-roll with `useFrame`, so pulling in drei (and
 * its own dependency tree, including `troika-three-text` if `<Text>` were used for the labels)
 * would add weight for nothing this ticket needs. Labels are plain DOM underneath the canvas
 * instead of in-scene text — cheaper, doesn't need a font asset loaded into WebGL, and is
 * arguably more legible than tiny extruded 3D text at this scale anyway.
 *
 * Box color always comes from `LotStateEvent.badge` — the gateway's own summary judgement
 * (docs/SWARM-API.md's badges table) — mapped through the shared `BADGE_COLORS` in ./colors.ts
 * so the 3D scene and the 2D `.badge` chips never disagree about what a color means. This is a
 * glanceable twin, not the S2-03 client-side proof re-verification; it never claims to be that.
 */

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { Badge, type LotStateEvent } from "@krishichain/core";

import { BADGE_COLORS } from "./colors";

function truncateLot(hex: string): string {
  if (hex.length <= 12) return hex;
  return `${hex.slice(0, 6)}…${hex.slice(-4)}`;
}

/** Whole-scene slow spin — the "3D-lite" auto-rotate, no OrbitControls needed. */
function SpinningRig({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.15;
  });
  return <group ref={group}>{children}</group>;
}

function Crate({ lot, x }: { lot: LotStateEvent; x: number }) {
  const mesh = useRef<THREE.Mesh>(null);
  const color = BADGE_COLORS[lot.badge] ?? BADGE_COLORS[Badge.PENDING_ANCHOR];
  const height = lot.flagged ? 1.9 : 1.2;

  // A slow emissive pulse on a flagged crate — the "breach → twin updates" cue, kept as a
  // gentle glow rather than anything jarring (ticket: "keep it simple and readable").
  useFrame(({ clock }) => {
    if (!mesh.current) return;
    const material = mesh.current.material as THREE.MeshStandardMaterial;
    if (lot.flagged) {
      material.emissiveIntensity = 0.35 + Math.sin(clock.elapsedTime * 3) * 0.25;
    } else {
      material.emissiveIntensity = 0;
    }
  });

  return (
    <mesh ref={mesh} position={[x, height / 2, 0]} castShadow>
      <boxGeometry args={[1.1, height, 1.1]} />
      <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0} roughness={0.55} metalness={0.05} />
    </mesh>
  );
}

function Ground() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#f6f9fc" />
    </mesh>
  );
}

export function CrateTwins({ lots }: { lots: LotStateEvent[] }) {
  const spacing = 2.2;
  const laidOut = useMemo(() => {
    const start = -((lots.length - 1) * spacing) / 2;
    return lots.map((lot, i) => ({ lot, x: start + i * spacing }));
  }, [lots]);

  return (
    <Canvas
      shadows
      camera={{ position: [7, 6, 9], fov: 32 }}
      style={{ height: "100%", width: "100%" }}
      dpr={[1, 1.5]}
    >
      <color attach="background" args={["#f6f9fc"]} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[6, 10, 4]} intensity={0.9} castShadow />
      <SpinningRig>
        <Ground />
        {laidOut.map(({ lot, x }) => (
          <Crate key={lot.lot} lot={lot} x={x} />
        ))}
      </SpinningRig>
    </Canvas>
  );
}

export function crateLegendItems(lots: LotStateEvent[]) {
  return lots.map((lot) => ({
    lot: lot.lot,
    label: truncateLot(lot.lot),
    badge: lot.badge,
    lastTempDeciC: lot.lastTempDeciC,
    flagged: lot.flagged,
  }));
}
