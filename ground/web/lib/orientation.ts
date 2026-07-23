/**
 * orientation.ts — tiny hand-rolled 3D projection for the accel-derived
 * orientation view. No three.js: a flat rectangular BOARD model (not a
 * rocket — see the calibration wizard, components/CalibrationWizard.tsx) is
 * a handful of 3D line segments, rotated by the measured accel vector via
 * Rodrigues' rotation formula, then projected with a fixed camera transform.
 *
 * IMPORTANT simplification (documented in the UI too): an accelerometer at
 * rest measures the reaction to gravity, so the DIRECTION of (gx,gy,gz) in
 * board coordinates tells you which way "up" currently points relative to
 * the board — i.e. tilt, with no yaw information. In powered flight the
 * same vector is dominated by thrust, not gravity, so this is a tilt/thrust-
 * axis indicator, not a full attitude solution.
 *
 * AXIS CONVENTION (fixed by this tool, solved per-board by the calibration
 * wizard): board axes are `x` = short edge, `y` = long edge, `z` = face-
 * normal. The model's neutral/rest pose is always "flat, face up" — i.e.
 * its own +Z is the rotation reference — so a board lying flat and level
 * renders upright/level, and any real tilt visibly rotates it away from
 * that rest pose. (Previously the rotation reference was read from the
 * descriptor's `up` field, which defaulted to "+z" too, but the camera's
 * fixed pitch/yaw made even the untilted case render like a tilted diamond
 * — fixed below by using a much shallower, near-top-down camera suited to a
 * flat object instead of a standing rocket.) `up` is now purely an
 * informational label (which axis is the flight/thrust axis to highlight),
 * decoupled from the rotation math.
 */
import type { ImuSpec } from "./types";

export type Vec3 = [number, number, number];
export type AxisMap = [string, string, string];

/** Identity mapping — assumes the raw sensor axes already line up with the
 *  board's own short/long/normal axes. The starting point before
 *  calibration; almost always wrong for a real board until the wizard runs. */
export const IDENTITY_MAP: AxisMap = ["+x", "+y", "+z"];

const AXIS_INDEX: Record<string, number> = { x: 0, y: 1, z: 2 };

/**
 * Re-express a raw sensor vector in the board's own x(short)/y(long)/
 * z(normal) frame, per a calibrated `map` (see ImuSpec.map's doc comment).
 * `map[i]` says which signed board axis raw[i] contributes to.
 */
export function applyAxisMap(raw: Vec3, map?: AxisMap): Vec3 {
  const m = map && map.length === 3 ? map : IDENTITY_MAP;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const token = m[i] || IDENTITY_MAP[i];
    const sign = token.trim().startsWith("-") ? -1 : 1;
    const letter = token.trim().slice(-1).toLowerCase();
    const axis = AXIS_INDEX[letter] ?? i;
    out[axis] += sign * raw[i];
  }
  return out;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-6) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Rodrigues' rotation formula: rotate vector `v` by the rotation that maps
 *  unit vector `from` onto unit vector `to`. */
function rotateFromTo(v: Vec3, from: Vec3, to: Vec3): Vec3 {
  const f = normalize(from);
  const t = normalize(to);
  const c = Math.max(-1, Math.min(1, dot(f, t)));
  if (c > 0.99999) return v; // already aligned
  if (c < -0.99999) {
    // 180° flip — pick any axis perpendicular to f
    const arbitrary: Vec3 = Math.abs(f[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const axis = normalize(cross(f, arbitrary));
    return rotateAroundAxis(v, axis, Math.PI);
  }
  const axis = normalize(cross(f, t));
  const angle = Math.acos(c);
  return rotateAroundAxis(v, axis, angle);
}

function rotateAroundAxis(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const [kx, ky, kz] = axis;
  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);
  const kv = kx * v[0] + ky * v[1] + kz * v[2];
  const cross_kv: Vec3 = [ky * v[2] - kz * v[1], kz * v[0] - kx * v[2], kx * v[1] - ky * v[0]];
  return [
    v[0] * cosA + cross_kv[0] * sinA + kx * kv * (1 - cosA),
    v[1] * cosA + cross_kv[1] * sinA + ky * kv * (1 - cosA),
    v[2] * cosA + cross_kv[2] * sinA + kz * kv * (1 - cosA),
  ];
}

const REST_AXIS: Vec3 = [0, 0, 1]; // board's own +Z (face-normal) — the fixed rotation reference

/** Angle (degrees) between the measured (already axis-mapped) accel vector
 *  and the board's flat/rest pose — 0 = lying flat & level, 90 = on edge. */
export function tiltAngleDeg(accelBoardFrame: Vec3): number {
  const a = normalize(accelBoardFrame);
  const c = Math.max(-1, Math.min(1, dot(a, REST_AXIS)));
  return (Math.acos(c) * 180) / Math.PI;
}

/** Rotate every point of the body-frame board model so its rest axis (+Z)
 *  points along the measured (already axis-mapped, normalized) accel
 *  vector. Flat & level -> accel ≈ (0,0,1) -> no rotation -> renders flat. */
export function orientModel(points: Vec3[], accelBoardFrame: Vec3): Vec3[] {
  const a = normalize(accelBoardFrame);
  return points.map((p) => rotateFromTo(p, REST_AXIS, a));
}

/**
 * Fixed camera. Chosen SHALLOW (near top-down) rather than the oblique
 * side-on angle a standing rocket would want — this is a flat board now, so
 * a mostly-overhead view is what makes "flat & level" actually look flat and
 * level instead of a tilted diamond, while still giving enough depth to see
 * genuine tilts rotate it out of that resting look.
 */
export function project(p: Vec3, scale: number, cx: number, cy: number): [number, number, number] {
  const camPitch = (-62 * Math.PI) / 180;
  const camYaw = (16 * Math.PI) / 180;
  let [x, y, z] = p;
  const y1 = y * Math.cos(camPitch) - z * Math.sin(camPitch);
  const z1 = y * Math.sin(camPitch) + z * Math.cos(camPitch);
  y = y1;
  z = z1;
  const x2 = x * Math.cos(camYaw) + z * Math.sin(camYaw);
  const z2 = -x * Math.sin(camYaw) + z * Math.cos(camYaw);
  x = x2;
  z = z2;
  return [cx + x * scale, cy - y * scale, z];
}

/**
 * A bare rectangular PCB — no rocket. Body frame: x = short edge, y = long
 * edge, z = face-normal (thin). A small notch on one long edge + a corner
 * dot mark a fixed reference point ("pin 1") so rotation reads legibly.
 */
const HX = 0.55; // half-width (short, x)
const HY = 0.95; // half-length (long, y)
const HZ = 0.06; // half-thickness (z)

function boxCorners(hx: number, hy: number, hz: number): Vec3[] {
  const s = [-1, 1];
  const pts: Vec3[] = [];
  for (const sx of s) for (const sy of s) for (const sz of s) pts.push([sx * hx, sy * hy, sz * hz]);
  return pts;
}

// ── Calibration wizard math ─────────────────────────────────────────────────
// See components/CalibrationWizard.tsx for the 3-step capture UI. The
// operator poses the bare board three ways and we read off, per pose, which
// RAW sensor axis is reading ~+1g (i.e. which raw axis is currently
// vertical) — that tells us which raw axis measures which BOARD axis, with
// what sign.

export interface CalibrationSamples {
  /** Raw (gx,gy,gz) averaged while the board lay FLAT, face up. */
  flat: Vec3;
  /** Raw (gx,gy,gz) averaged while the board stood on end, LONG edge up. */
  longUp: Vec3;
  /** Raw (gx,gy,gz) averaged while the board stood on end, SHORT edge up. */
  shortUp: Vec3;
}

export interface CalibrationResult {
  map: AxisMap;
  up: ImuSpec["up"];
}

const RAW_LETTERS = ["gx", "gy", "gz"];

/** Dominant raw axis (0/1/2) + sign of a normalized vector, i.e. "which raw
 *  axis is reading ~+-1g right now" — the axis currently pointing "up". */
function dominantAxis(v: Vec3): { axis: 0 | 1 | 2; sign: 1 | -1; magnitude: number } {
  const n = normalize(v);
  const abs: Vec3 = [Math.abs(n[0]), Math.abs(n[1]), Math.abs(n[2])];
  let axis: 0 | 1 | 2 = 0;
  if (abs[1] > abs[axis]) axis = 1;
  if (abs[2] > abs[axis]) axis = 2;
  return { axis, sign: n[axis] >= 0 ? 1 : -1, magnitude: abs[axis] };
}

/**
 * Solve the signed axis permutation from the three calibration poses. Each
 * pose isolates exactly one board axis as "vertical" (flat -> z, long-edge-
 * up -> y, short-edge-up -> x); whichever raw axis dominates that pose's
 * reading is the raw axis that measures that board axis, and the sign is
 * whatever makes a +1g reading in that pose come out positive (i.e. the
 * measured sign itself — a negative dominant reading means that raw axis is
 * mounted backwards relative to the board axis, so the map flips it).
 *
 * Fails loudly (rather than silently guessing) if a pose wasn't held
 * steady/square (no single axis clearly dominates) or if two poses both
 * point at the same raw axis (the board wasn't actually rotated between
 * captures) — both are operator-fixable by retrying that step.
 */
export function solveCalibration(samples: CalibrationSamples): CalibrationResult | { error: string } {
  const poses: Array<{ v: Vec3; target: "x" | "y" | "z"; label: string }> = [
    { v: samples.shortUp, target: "x", label: "short-edge-up" },
    { v: samples.longUp, target: "y", label: "long-edge-up" },
    { v: samples.flat, target: "z", label: "flat" },
  ];

  const map: (string | null)[] = [null, null, null];
  const usedRaw = new Set<number>();
  const usedTarget = new Set<string>();

  for (const pose of poses) {
    const { axis, sign, magnitude } = dominantAxis(pose.v);
    if (magnitude < 0.6) {
      return {
        error: `The "${pose.label}" reading isn't clearly dominated by one axis (best axis only ${Math.round(
          magnitude * 100
        )}% of the vector) — hold the board still and square to that pose, then retry.`,
      };
    }
    if (usedRaw.has(axis)) {
      return {
        error: `Both this pose and an earlier one point to raw axis ${RAW_LETTERS[axis]} — the board wasn't rotated between poses. Retry each step in a distinctly different orientation.`,
      };
    }
    usedRaw.add(axis);
    usedTarget.add(pose.target);
    map[axis] = `${sign > 0 ? "+" : "-"}${pose.target}`;
  }

  if (usedTarget.size < 3 || map.some((m) => m == null)) {
    return { error: "Calibration inconclusive — could not resolve all three board axes. Retry the wizard." };
  }

  // Long axis (y) is the flight/thrust axis by this tool's convention — see
  // ImuSpec.up's doc comment.
  return { map: map as AxisMap, up: "+y" };
}

export const BOARD_MODEL = {
  corners: boxCorners(HX, HY, HZ),
  // edges as index pairs into `corners` (corners ordered x-major: --- --+ -+- -++ +-- +-+ ++- +++)
  edges: [
    [0, 1], [1, 3], [3, 2], [2, 0], // x=-hx face
    [4, 5], [5, 7], [7, 6], [6, 4], // x=+hx face
    [0, 4], [1, 5], [2, 6], [3, 7], // connecting struts
  ] as [number, number][],
  // reference marker: a small dot near the +x,+y,+z corner (top face, one
  // long-edge corner) so the render has a fixed point to judge rotation by
  marker: [HX * 0.7, HY * 0.7, HZ] as Vec3,
  // notch tick on the +y (far long) edge, top face, to mark "front"
  notch: { a: [-0.12, HY, HZ] as Vec3, b: [0.12, HY, HZ] as Vec3, tip: [0, HY + 0.16, HZ] as Vec3 },
};
