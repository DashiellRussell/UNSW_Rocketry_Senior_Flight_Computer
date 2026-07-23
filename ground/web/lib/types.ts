/**
 * types.ts — FCD/1 descriptor shapes. Mirrors docs/fcd-protocol.md §4 exactly.
 * Every field but `p`/`name` is optional and degrades gracefully — a board
 * that declares nothing still gets plain TLM/LOG parsing.
 */

export interface CheckSpec {
  id: string;
  label: string;
  /** TLM boolean key that means PASS for this check (board streams it in
   *  every TLM line, e.g. "pg"/"baro_ok"/"accel_ok"/"sd_ok"). PASS when
   *  TLM[check]==1, FAIL when ==0. Checks with NO `check` field are purely
   *  informational (e.g. "pyro continuity" duplicates the per-channel CONT/
   *  OPEN badges already shown in the pyro panel) and never resolve — they
   *  stay on "monitoring…" forever, by design. */
  check?: string;
}

export interface RailSpec {
  id: string;
  label: string;
  min?: number;
  max?: number;
  nom?: number;
}

export interface GraphSpec {
  id: string;
  label: string;
  unit?: string;
}

/**
 * Accel-derived tilt indicator. Optional — a board that omits `imu` entirely
 * just doesn't get the 3D orientation view.
 *
 * `accel` — the 3 TLM keys carrying the RAW per-axis specific-force
 * components (g), in raw-sensor-axis order (accel[0]=raw axis 0, etc).
 *
 * `map` — the signed axis permutation solved by the orientation
 * CALIBRATION WIZARD (components/CalibrationWizard.tsx): `map[i]` says which
 * BOARD axis (and sign) `accel[i]` measures. Board axes are fixed by
 * convention as `x` = short edge, `y` = long edge, `z` = face-normal.
 * E.g. `map: ["+x","+z","-y"]` means raw accel[0] reads +1g when the
 * board's +X edge is "up", accel[1] reads +1g on board +Z (flat, face up),
 * and accel[2] reads +1g when the board's -Y edge is "up" (i.e. board Y is
 * the NEGATIVE of that raw axis). Identity (`["+x","+y","+z"]`, the default
 * if a board doesn't declare `map`) assumes the raw axes already match the
 * board's physical short/long/normal axes — usually wrong until calibrated.
 *
 * `up` — which BOARD axis (in the x/y/z convention above) is vertical when
 * the rocket sits on the pad — normally the long axis (`y`), since a PCB is
 * typically mounted with its long edge parallel to the airframe's thrust
 * axis. Purely a label for the UI (which axis to highlight as "the flight
 * axis"); it does NOT change the orientation math, which always renders the
 * board's neutral/rest pose as flat (board +Z up) — see lib/orientation.ts.
 */
export interface ImuSpec {
  accel: [string, string, string];
  map?: [string, string, string];
  up: "+x" | "-x" | "+y" | "-y" | "+z" | "-z";
  units?: string;
  g_rest?: number;
}

export type ParamType = "float" | "int" | "bool" | "enum";

export interface ParamSpec {
  id: string;
  label: string;
  type: ParamType;
  value: number | string | boolean;
  min?: number;
  max?: number;
  values?: string[];
  unit?: string;
}

export interface ActionArgSpec {
  id: string;
  label?: string;
  type?: string;
  min?: number;
  max?: number;
  values?: string[];
}

export interface ActionSpec {
  id: string;
  label: string;
  confirm?: string;
  danger?: boolean;
  args?: ActionArgSpec[];
}

export interface Caps {
  pyro?: number;
  arm?: boolean;
  logs?: boolean;
  telemetry?: boolean;
  /** Non-standard (see README ambiguities): board expects seq+CRC framing on safety commands. */
  integrity?: boolean;
  [key: string]: unknown;
}

export interface Descriptor {
  p: string;
  name: string;
  sub?: string;
  fw?: string;
  accent?: string;
  checks?: CheckSpec[];
  rails?: RailSpec[];
  graphs?: GraphSpec[];
  tlm?: string[];
  states?: string[];
  params?: ParamSpec[];
  actions?: ActionSpec[];
  caps?: Caps;
  imu?: ImuSpec | null;
}

/** Descriptor after normalisation: every array is guaranteed present. */
export interface Profile {
  p: string;
  name: string;
  sub: string;
  fw: string;
  accent: string;
  checks: CheckSpec[];
  rails: RailSpec[];
  graphs: GraphSpec[];
  tlm: string[];
  states: string[];
  params: ParamSpec[];
  actions: ActionSpec[];
  caps: Caps;
  hasPyro: boolean;
  imu: ImuSpec | null;
}

export type TlmValue = number | string | boolean;
export type TlmFrame = Record<string, TlmValue>;

export type CheckStatus = "pending" | "pass" | "warn" | "fail";

export type TransportKind = "serial" | "ws" | "sim";

export type FireMode = "safe" | "session" | "hot" | "direct";

export const GENERIC_PROFILE: Profile = {
  p: "fcd/1",
  name: "UNKNOWN BOARD",
  sub: "no FCD1 descriptor received — generic fallback",
  fw: "",
  accent: "white",
  checks: [],
  rails: [],
  graphs: [],
  tlm: [],
  params: [],
  actions: [],
  states: ["PAD", "BOOST", "COAST", "APOGEE", "DESCENT", "LANDED"],
  caps: {},
  hasPyro: false,
  imu: null,
};

export function normaliseProfile(raw: Descriptor): Profile {
  const p = JSON.parse(JSON.stringify(raw)) as Descriptor;
  const caps = p.caps || {};
  return {
    p: p.p,
    name: p.name,
    sub: p.sub || "",
    fw: p.fw || "",
    accent: p.accent || "cyan",
    checks: p.checks || [],
    rails: p.rails || [],
    graphs: p.graphs || [],
    tlm: p.tlm || [],
    states: p.states || GENERIC_PROFILE.states,
    params: p.params || [],
    actions: p.actions || [],
    caps,
    hasPyro: Number(caps.pyro || 0) > 0,
    imu: p.imu || null,
  };
}
