/**
 * lib/builder/mockEngine.ts — the builder's own built-in telemetry mock.
 * Same spirit as lib/sim.ts's SimTransport (a plausible flight so graphs
 * scroll, rails fill, checks resolve, and the orientation view animates)
 * but generic over WHATEVER descriptor is currently composed — it reads the
 * live `Profile` and synthesises a value for every declared check/rail/
 * graph/imu-axis key, guessing a plausible waveform shape from the key's
 * id/unit (altitude/velocity/accel/pressure/temperature/voltage/generic).
 *
 * Deliberately a plain class (no React) driven by a `setInterval`, mirroring
 * SimTransport's own tick loop — `useMockEngine` (./useMockEngine.ts) is the
 * thin React wrapper that owns its lifecycle.
 */
import type { Caps, Profile, TlmFrame, TlmValue } from "@/lib/types";

export type FrameListener = (frame: TlmFrame) => void;

const TICK_MS = 120;

interface FlightSample {
  alt: number;
  vel: number;
  gz: number;
  state: string;
}

/** A small deterministic flight arc — pad -> boost -> coast -> apogee ->
 *  descent -> landed -> loops back to pad — independent of the real
 *  FlightModel in lib/sim.ts (kept local so this file never touches that
 *  shared module). */
class DemoFlight {
  private readonly peakAlt = 850;
  private readonly burnS = 2.2;
  private readonly padS = 2.5;
  private readonly A: number;
  private readonly vBurnout: number;
  private readonly boostH: number;
  private readonly tApogee: number;
  private readonly g = 9.81;
  private readonly loopS: number;

  constructor() {
    this.A = Math.sqrt(2 * this.g * this.peakAlt) / this.burnS;
    this.vBurnout = this.A * this.burnS;
    this.boostH = 0.5 * this.A * this.burnS * this.burnS;
    this.tApogee = this.padS + this.burnS + this.vBurnout / this.g;
    this.loopS = this.tApogee + 24; // enough runway to reach ~landed, then loop
  }

  at(tAbs: number): FlightSample {
    const t = tAbs % this.loopS;
    const { g, A, burnS, padS } = this;
    if (t < padS) return { alt: 0, vel: 0, gz: 1.0, state: "PAD" };
    const tb = t - padS;
    if (tb < burnS) return { alt: 0.5 * A * tb * tb, vel: A * tb, gz: A / g + 1.0, state: "BOOST" };
    const tc = tb - burnS;
    const v = this.vBurnout - g * tc;
    if (v > 0) {
      const h = this.boostH + this.vBurnout * tc - 0.5 * g * tc * tc;
      return { alt: h, vel: v, gz: 0.05, state: "COAST" };
    }
    const apogeeH = this.boostH + (this.vBurnout * this.vBurnout) / (2 * g);
    const td = t - this.tApogee;
    if (td < 1.0) return { alt: apogeeH, vel: -0.3 * td, gz: 0.1, state: "APOGEE" };
    let h = apogeeH - 22 * (td - 1.0);
    let v2 = -22;
    if (h < apogeeH * 0.3) {
      const over = apogeeH * 0.3 - h;
      h = apogeeH * 0.3 - over * (6 / 22);
      v2 = -6;
    }
    if (h <= 0) return { alt: 0, vel: 0, gz: 1.0, state: "LANDED" };
    return { alt: h, vel: v2, gz: 1.0, state: "DESCENT" };
  }
}

function baroPa(altM: number): number {
  return 101325.0 * Math.pow(1.0 - 2.25577e-5 * Math.max(altM, 0), 5.25588);
}

/** Guess a plausible generator for a graph/rail-like key from its id+unit. */
type Shape = "alt" | "vel" | "accel" | "pressure" | "temp" | "voltage" | "percent" | "generic";

function guessShape(id: string, unit?: string): Shape {
  const key = (id + " " + (unit || "")).toLowerCase();
  if (/alt|agl|height/.test(key)) return "alt";
  if (/vel|speed/.test(key)) return "vel";
  if (/\bg\b|accel|force/.test(key)) return "accel";
  if (/pa\b|pressure/.test(key)) return "pressure";
  if (/temp|°c|celsius/.test(key)) return "temp";
  if (/v\b|volt|batt/.test(key)) return "voltage";
  if (/%|percent/.test(key)) return "percent";
  return "generic";
}

export class MockEngine {
  private timer: ReturnType<typeof setInterval> | null = null;
  private t0 = 0;
  private flight = new DemoFlight();
  private listeners = new Set<FrameListener>();
  private failingCheckId: string | null = null;
  private genericWalk = new Map<string, number>();
  private armed = false;
  private fired: Record<number, boolean> = {};
  private sessionKey: number | null = null;
  private trig: Record<number, { primeToken: number | null; primeExpiry: number; deployReady: boolean; dtok: number; dtokExpiry: number }> = {};

  constructor(private profile: Profile) {}

  updateProfile(p: Profile) {
    this.profile = p;
  }

  subscribe(fn: FrameListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  start() {
    if (this.timer) return;
    this.t0 = performance.now() / 1000;
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private padT(): number {
    return performance.now() / 1000 - this.t0;
  }

  private tick() {
    const t = this.padT();
    const sample = this.flight.at(t);
    const vals: TlmFrame = { t_ms: Math.round(t * 1000), state: sample.state };

    // ── checks: all-pass, except one rotating check that briefly FAILs so
    // the panel demonstrates its red state too (mirrors sim.ts's baro dropout). ──
    const checkKeys = this.profile.checks.map((c) => c.check).filter((k): k is string => !!k);
    if (checkKeys.length) {
      const cyclePos = Math.floor(t / 6) % checkKeys.length;
      const withinFailWindow = t % 6 < 0.7;
      this.failingCheckId = withinFailWindow ? checkKeys[cyclePos] : null;
      for (const k of checkKeys) vals[k] = k === this.failingCheckId ? 0 : 1;
    }

    // ── rails: sine wander around nominal within [min,max]. ──
    for (const r of this.profile.rails) {
      const lo = r.min ?? 6.4;
      const hi = r.max ?? 8.4;
      const nom = r.nom ?? (lo + hi) / 2;
      const amp = Math.min(nom - lo, hi - nom, (hi - lo) * 0.06);
      vals[r.id] = Number((nom + Math.sin(t * 0.6 + hashSeed(r.id)) * amp - t * 0.0004).toFixed(3));
    }

    // ── graphs: shape-guessed plausible waveform. ──
    for (const g of this.profile.graphs) {
      vals[g.id] = this.sampleGraph(g.id, g.unit, sample, t);
    }

    // ── imu: orientation wander identical in spirit to sim.ts. ──
    if (this.profile.imu) {
      const tiltDeg =
        sample.state === "PAD" ? 3 : sample.state === "BOOST" ? 1.2 : sample.state === "COAST" ? 5 : sample.state === "APOGEE" ? 14 : sample.state === "DESCENT" ? 22 : 7;
      const tiltX = (Math.sin(t * 0.55) * tiltDeg * Math.PI) / 180;
      const tiltY = (Math.cos(t * 0.34 + 1.7) * tiltDeg * 0.7 * Math.PI) / 180;
      const gz = sample.gz;
      const [ax, ay, az] = this.profile.imu.accel;
      vals[ax] = Number((gz * Math.sin(tiltX)).toFixed(3));
      vals[ay] = Number((gz * Math.sin(tiltY)).toFixed(3));
      vals[az] = Number((gz * Math.cos(tiltX) * Math.cos(tiltY)).toFixed(3));
    }

    // ── pyro-adjacent keys, only if the board declares pyro channels. ──
    const caps: Caps = this.profile.caps || {};
    const pyroN = Number(caps.pyro || 0);
    if (pyroN > 0) {
      vals.armed = this.armed ? 1 : 0;
      for (let ch = 1; ch <= pyroN; ch++) {
        if (!this.trig[ch]) this.trig[ch] = { primeToken: null, primeExpiry: 0, deployReady: false, dtok: 0, dtokExpiry: 0 };
        const tr = this.trig[ch];
        if (tr.deployReady && t > tr.dtokExpiry) {
          tr.dtok = Math.floor(1000 + Math.random() * 9000);
          tr.dtokExpiry = t + 4.0;
        }
        if (tr.primeToken && t > tr.primeExpiry) tr.primeToken = null;
        vals[`cont${ch}`] = this.fired[ch] ? 0 : 1;
        vals[`dtok${ch}`] = tr.dtok;
      }
    }

    this.emit(vals);
  }

  private sampleGraph(id: string, unit: string | undefined, sample: FlightSample, t: number): number {
    const shape = guessShape(id, unit);
    switch (shape) {
      case "alt":
        return Number(sample.alt.toFixed(2));
      case "vel":
        return Number(sample.vel.toFixed(2));
      case "accel":
        return Number(Math.min(sample.gz, 16).toFixed(2));
      case "pressure":
        return Number(baroPa(sample.alt).toFixed(1));
      case "temp":
        return Number((21.0 - sample.alt * 0.0065 + Math.sin(t * 0.3) * 0.1).toFixed(2));
      case "voltage":
        return Number((7.4 + Math.sin(t * 0.5 + hashSeed(id)) * 0.08).toFixed(3));
      case "percent":
        return Number(Math.max(0, Math.min(100, 50 + Math.sin(t * 0.4 + hashSeed(id)) * 40)).toFixed(1));
      default: {
        const prev = this.genericWalk.get(id) ?? 0;
        const next = prev + (Math.random() - 0.5) * 2 - prev * 0.08;
        this.genericWalk.set(id, next);
        return Number(next.toFixed(2));
      }
    }
  }

  private emit(vals: TlmFrame) {
    this.listeners.forEach((fn) => fn(vals));
  }

  /** Mirrors SimTransport.doAction's semantics closely enough that
   *  ActionsPanel/PyroPanel behave the same in preview as on a real board —
   *  see lib/sim.ts for the reference implementation this is adapted from. */
  async invoke(id: string, args: Record<string, unknown> = {}): Promise<string> {
    await delay(120);
    const ch = Number(args.ch || 0);
    switch (id) {
      case "arm":
        this.armed = true;
        return "ACK arm armed";
      case "disarm":
        this.armed = false;
        this.resetTrig();
        return "ACK disarm safe";
      case "safe":
        this.resetTrig();
        return "ACK safe cleared";
      case "flight_mode": {
        this.armed = true;
        const fireModeParam = this.profile.params.find((p) => p.id === "fire_mode");
        const mode = fireModeParam ? String(fireModeParam.value) : "direct";
        if (mode === "session") {
          const key = args.key ? Number(args.key) : Math.floor(100000 + Math.random() * 899999);
          this.sessionKey = key;
          return `ACK flight_mode key=${key}`;
        }
        return "ACK flight_mode armed";
      }
      case "stop":
        this.armed = false;
        return "ACK stop ended";
      case "prime": {
        if (!ch || !this.trig[ch]) return "ERR channel";
        const token = Math.floor(1000 + Math.random() * 9000);
        this.trig[ch].primeToken = token;
        this.trig[ch].primeExpiry = this.padT() + 10.0;
        return `ACK prime ch${ch} token=${token} window=10s`;
      }
      case "deploy_ready": {
        if (!ch || !this.trig[ch]) return "ERR channel";
        this.trig[ch].deployReady = true;
        this.trig[ch].dtok = Math.floor(1000 + Math.random() * 9000);
        this.trig[ch].dtokExpiry = this.padT() + 4.0;
        return `ACK deploy_ready ch${ch}`;
      }
      case "fire": {
        if (!ch) return "ERR channel";
        this.fired[ch] = true;
        return `ACK fire ch${ch} fired`;
      }
      default:
        return `ACK ${id} ok`;
    }
  }

  private resetTrig() {
    for (const k of Object.keys(this.trig)) delete this.trig[Number(k)];
    this.sessionKey = null;
  }

  /** Mirrors SimTransport's `set` handling: validates against the param's
   *  own spec (range/enum) before "accepting" it. */
  async setParam(id: string, value: string): Promise<string> {
    await delay(100);
    const spec = this.profile.params.find((p) => p.id === id);
    if (!spec) return `ERR unknown param ${id}`;
    if (spec.type === "enum" && spec.values && !spec.values.includes(value)) return "ERR range";
    if ((spec.type === "float" || spec.type === "int") && spec.min != null && spec.max != null) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < spec.min || n > spec.max) return "ERR range";
    }
    return `PARAM ${id}=${value}`;
  }
}

function hashSeed(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h % 628) / 100;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export type { TlmValue };
