/**
 * lib/builder/paletteDefs.ts — the palette's draggable chip catalogue.
 * Each entry knows how to mint a fresh block (with sane defaults + a
 * collision-avoiding id) when dropped onto the canvas.
 */
import type { BlockKind, BuilderBlock, MetaData } from "./types";
import { uid } from "./types";

export interface PaletteDef {
  kind: BlockKind;
  title: string;
  blurb: string;
  singleton: boolean;
  make: (existing: BuilderBlock[]) => BuilderBlock;
}

function freshId(existing: BuilderBlock[], prefix: string): string {
  const taken = new Set(
    existing
      .map((b) => (b.data as { id?: string }).id)
      .filter((v): v is string => typeof v === "string")
  );
  let n = 1;
  let candidate = `${prefix}${n}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${prefix}${n}`;
  }
  return candidate;
}

export const PALETTE: PaletteDef[] = [
  {
    kind: "meta",
    title: "Board meta",
    blurb: "name / sub / fw / accent",
    singleton: true,
    make: () => ({
      uid: uid(),
      kind: "meta",
      data: { name: "MY BOARD", sub: "", fw: "0.1.0", accent: "cyan" } as MetaData,
    }),
  },
  {
    kind: "check",
    title: "Check",
    blurb: "preflight pass/fail row",
    singleton: false,
    make: (existing) => ({
      uid: uid(),
      kind: "check",
      data: { id: freshId(existing, "check"), label: "New check", check: "" },
    }),
  },
  {
    kind: "rail",
    title: "Rail",
    blurb: "power-rail voltage meter",
    singleton: false,
    make: (existing) => ({
      uid: uid(),
      kind: "rail",
      data: { id: freshId(existing, "rail"), label: "New rail", min: 6.4, max: 8.4, nom: 7.4 },
    }),
  },
  {
    kind: "graph",
    title: "Graph",
    blurb: "scrolling telemetry chart",
    singleton: false,
    make: (existing) => ({
      uid: uid(),
      kind: "graph",
      data: { id: freshId(existing, "graph"), label: "New graph", unit: "" },
    }),
  },
  {
    kind: "param",
    title: "Param",
    blurb: "float / int / bool / enum setting",
    singleton: false,
    make: (existing) => ({
      uid: uid(),
      kind: "param",
      data: { id: freshId(existing, "param"), label: "New param", type: "float", value: 0, min: 0, max: 100 },
    }),
  },
  {
    kind: "action",
    title: "Action",
    blurb: "command button (confirm/danger/args)",
    singleton: false,
    make: (existing) => ({
      uid: uid(),
      kind: "action",
      data: { id: freshId(existing, "action"), label: "New action" },
    }),
  },
  {
    kind: "imu",
    title: "IMU orientation",
    blurb: "accel-derived tilt view",
    singleton: true,
    make: () => ({
      uid: uid(),
      kind: "imu",
      data: { accel: ["lo_gx", "lo_gy", "lo_gz"], map: ["+x", "+y", "+z"], up: "+y", units: "g", g_rest: 1.0 },
    }),
  },
  {
    kind: "caps",
    title: "Caps flags",
    blurb: "pyro / arm / logs / telemetry / integrity",
    singleton: true,
    make: () => ({
      uid: uid(),
      kind: "caps",
      data: { pyro: 0, arm: false, logs: true, telemetry: true, integrity: false },
    }),
  },
];
