/**
 * sim.ts — built-in FCD/1 mock board, so the dashboard can be demoed with no
 * hardware attached. Implements the Transport interface identically to
 * SerialTransport/WebSocketTransport so the app can't tell them apart.
 *
 * Ported from firmware/tools/web-dashboard/js/sim.js with one reconciled
 * behaviour change: the session-mode command is `do flight_mode [key=]`
 * (not `session_key`) — see docs/fcd-protocol.md §7 Mode B and pyro_trigger.h.
 * `flight_mode` both arms + starts logging (any fire_mode) AND, only in
 * `session` mode, establishes/returns the flight pyro key on the same line.
 *
 * Exercises every feature the dashboard renders: checks, rails, graphs,
 * params (including a `fire_mode` enum so all four pyro_trigger.h modes can
 * be demoed), actions, and a little deterministic flight model so the
 * graphs/log pane have something interesting to show.
 */
import type { Descriptor, ParamSpec } from "./types";
import type { Transport } from "./transports";

const SIM_FCD: Descriptor = {
  p: "fcd/1",
  name: "PROJECT OZONE (SIM)",
  sub: "UNSW Rocketry — Senior Flight Computer (STM32L452) — built-in demo board",
  fw: "0.1.0-sim",
  accent: "cyan",
  checks: [
    { id: "power", label: "Power", check: "pg" },
    { id: "baro", label: "Barometers", check: "baro_ok" },
    { id: "accel", label: "Accelerometers", check: "accel_ok" },
    { id: "sd", label: "SD card", check: "sd_ok" },
    { id: "pyro", label: "Pyro continuity" }, // no `check` — informational; see per-channel CONT/OPEN badges
  ],
  rails: [
    { id: "vbat", label: "Main batt", min: 6.4, max: 8.4, nom: 7.4 },
    { id: "pyro_v", label: "Pyro batt", min: 6.4, max: 8.4, nom: 7.4 },
  ],
  graphs: [
    { id: "agl_m", label: "Altitude AGL", unit: "m" },
    { id: "vel_ms", label: "Vertical vel", unit: "m/s" },
    { id: "hi_g", label: "Hi-g accel", unit: "g" },
    { id: "lo_g", label: "Lo-g accel", unit: "g" },
    { id: "pressure_pa", label: "Pressure", unit: "Pa" },
    { id: "temp_c", label: "Temperature", unit: "C" },
  ],
  tlm: [
    "t_ms", "state", "agl_m", "alt_m", "vel_ms", "pressure_pa", "temp_c",
    "hi_g", "lo_g", "lo_gx", "lo_gy", "lo_gz", "vbat", "pyro_v", "armed",
    "cont1", "cont2", "dtok1", "dtok2", "pg", "baro_ok", "accel_ok", "sd_ok",
  ],
  states: ["PAD", "BOOST", "COAST", "APOGEE", "DESCENT", "LANDED"],
  // `map` identity by default — a real board needs the Calibrate wizard
  // (components/CalibrationWizard.tsx) to solve its actual axis wiring.
  imu: { accel: ["lo_gx", "lo_gy", "lo_gz"], map: ["+x", "+y", "+z"], up: "+y", units: "g", g_rest: 1.0 },
  params: [
    { id: "fire_mode", label: "Pyro fire mode", type: "enum", value: "safe", values: ["safe", "session", "hot", "direct"] },
    { id: "apogee_vel", label: "Apogee detect vel", type: "float", value: 3.0, min: 0, max: 50, unit: "m/s" },
    { id: "launch_g", label: "Launch detect", type: "float", value: 3.0, min: 1, max: 30, unit: "g" },
    { id: "main_alt_m", label: "Main deploy alt", type: "int", value: 150, min: 0, max: 2000, unit: "m AGL" },
    { id: "vbat_div", label: "VBAT divider", type: "float", value: 4.49 },
    { id: "log_rate_hz", label: "Log rate", type: "int", value: 50, min: 1, max: 200, unit: "Hz" },
  ],
  actions: [
    { id: "identify", label: "Identify (blink+beep)" },
    { id: "flight_mode", label: "Enter flight mode", danger: true, confirm: "FLIGHT",
      args: [{ id: "key", label: "session key (blank = board rolls one, session mode only)", type: "int", min: 0, max: 999999 }] },
    { id: "stop", label: "Stop / end flight (close log)", confirm: "STOP" },
    { id: "arm", label: "Arm pyros", confirm: "ARM" },
    { id: "disarm", label: "Disarm (make safe)" },
    { id: "prime", label: "Prime channel (safe mode)", danger: true, args: [{ id: "ch", label: "channel", type: "int", min: 1, max: 2 }] },
    { id: "deploy_ready", label: "Deploy-ready (hot mode)", danger: true, args: [{ id: "ch", label: "channel", type: "int", min: 1, max: 2 }] },
    { id: "fire", label: "Fire", danger: true, confirm: "FIRE", args: [{ id: "ch", label: "channel", type: "int", min: 1, max: 2 }] },
    { id: "safe", label: "Cancel prime / deploy-ready / session" },
    { id: "set_led", label: "Set RGB LED", args: [{ id: "colour", label: "colour", type: "enum",
        values: ["off", "red", "green", "blue", "white", "cyan", "magenta", "yellow"] }] },
    { id: "zero_baro", label: "Zero barometer" },
    { id: "erase_logs", label: "Erase SD logs", danger: true, confirm: "ERASE" },
  ],
  caps: { pyro: 2, arm: true, logs: true, telemetry: true, integrity: true },
};

function baroPa(altM: number): number {
  return 101325.0 * Math.pow(1.0 - 2.25577e-5 * Math.max(altM, 0), 5.25588);
}

interface FlightSample {
  alt: number;
  vel: number;
  state: string;
  gz: number;
}

class FlightModel {
  private g = 9.81;
  private padS: number;
  private burn: number;
  private A: number;
  private vBurnout: number;
  private boostH: number;
  private tApogee: number;
  private apogeeH: number;

  constructor({ apogeeM = 3000, burnS = 2.5, padS = 3.0 } = {}) {
    const g = this.g;
    this.padS = padS;
    this.burn = burnS;
    this.A = Math.sqrt(2 * g * apogeeM) / burnS;
    this.vBurnout = this.A * burnS;
    this.boostH = 0.5 * this.A * burnS * burnS;
    this.tApogee = padS + burnS + this.vBurnout / g;
    this.apogeeH = this.boostH + (this.vBurnout * this.vBurnout) / (2 * g);
  }

  get padStart(): number {
    return this.padS;
  }

  at(t: number): FlightSample {
    const { g, A, burn } = this;
    if (t < this.padS) return { alt: 0, vel: 0, state: "PAD", gz: 1.0 };
    const tb = t - this.padS;
    if (tb < burn) return { alt: 0.5 * A * tb * tb, vel: A * tb, state: "BOOST", gz: A / g + 1.0 };
    const tc = tb - burn;
    const v = this.vBurnout - g * tc;
    if (v > 0) {
      const h = this.boostH + this.vBurnout * tc - 0.5 * g * tc * tc;
      return { alt: h, vel: v, state: "COAST", gz: 0.05 };
    }
    const td = t - this.tApogee;
    if (td < 1.0) return { alt: this.apogeeH, vel: -0.3 * td, state: "APOGEE", gz: 0.1 };
    let h = this.apogeeH - 25.0 * (td - 1.0);
    let vDesc = -25.0;
    if (h < this.apogeeH * 0.3) {
      const over = this.apogeeH * 0.3 - h;
      h = this.apogeeH * 0.3 - over * (7.0 / 25.0);
      vDesc = -7.0;
    }
    if (h <= 0) return { alt: 0, vel: 0, state: "LANDED", gz: 1.0 };
    return { alt: h, vel: vDesc, state: "DESCENT", gz: 1.0 };
  }
}

interface ChTrig {
  primeToken: number | null;
  primeExpiry: number;
  deployReady: boolean;
  dtok: number;
  dtokExpiry: number;
}

export class SimTransport implements Transport {
  label = "SIMULATOR (no hardware)";
  private lineHandlers: ((line: string) => void)[] = [];
  private closeHandlers: ((reason: string) => void)[] = [];
  private t0 = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private launched = false;
  private launchAt = 4.0;
  private flightT0 = 0;
  private lastState = "";
  private model = new FlightModel({});
  private armed = false;
  private vbat = 7.82;
  private params: Record<string, string> = Object.fromEntries(
    (SIM_FCD.params || []).map((p) => [p.id, String(p.value)])
  );
  private fireMode = String(this.params.fire_mode);
  private trig: Record<number, ChTrig> = {
    1: { primeToken: null, primeExpiry: 0, deployReady: false, dtok: 0, dtokExpiry: 0 },
    2: { primeToken: null, primeExpiry: 0, deployReady: false, dtok: 0, dtokExpiry: 0 },
  };
  private sessionKey: number | null = null;
  private fired: Record<number, boolean> = { 1: false, 2: false };

  onLine(fn: (line: string) => void) {
    this.lineHandlers.push(fn);
  }
  onClose(fn: (reason: string) => void) {
    this.closeHandlers.push(fn);
  }

  private emit(line: string) {
    this.lineHandlers.forEach((f) => f(line));
  }

  async connect(): Promise<boolean> {
    this.t0 = performance.now() / 1000;
    this.timer = setInterval(() => this.tick(), 100);
    return true;
  }

  async disconnect() {
    if (this.timer) clearInterval(this.timer);
    this.closeHandlers.forEach((f) => f("simulator stopped"));
  }

  private padT() {
    return performance.now() / 1000 - this.t0;
  }

  private tick() {
    const t = this.padT();
    if (!this.launched && t >= this.launchAt) {
      this.launched = true;
      this.emit(`LOG INFO liftoff detected`);
      this.flightT0 = t;
    }
    let alt: number, vel: number, state: string, gz: number;
    if (!this.launched) {
      alt = (Math.random() - 0.5) * 0.6;
      vel = (Math.random() - 0.5) * 0.4;
      state = "PAD";
      gz = 1.0 + (Math.random() - 0.5) * 0.04;
    } else {
      const ft = t - this.flightT0;
      const m = this.model.at(this.model.padStart + ft);
      alt = m.alt;
      vel = m.vel;
      state = m.state;
      gz = m.gz;
      if (state !== this.lastState) {
        this.lastState = state;
        const evs: Record<string, string> = {
          BOOST: "liftoff confirmed — boosting",
          COAST: "motor burnout — coasting",
          APOGEE: `apogee detected (${alt.toFixed(0)} m)`,
          DESCENT: "drogue/main deploy sequence",
          LANDED: "landed — recovery beacon ON",
        };
        if (evs[state]) this.emit(`LOG INFO ${evs[state]}`);
      }
    }
    // Orientation model (SIM only): a gentle, continuously-animating tilt so
    // the 3D orientation view has something to show even against the
    // simulator. Slow small wander on the pad; the vector roughly re-aligns
    // with the velocity/thrust axis in flight (tight during BOOST, wider
    // during COAST/APOGEE/DESCENT as the rocket coasts/tumbles/hangs under
    // the chute). `gz` here is the flight model's accel-magnitude (g).
    const tiltDeg =
      state === "PAD" ? 3 : state === "BOOST" ? 1.2 : state === "COAST" ? 5 : state === "APOGEE" ? 14 : state === "DESCENT" ? 22 : 7;
    const tiltX = ((Math.sin(t * 0.55) * tiltDeg * Math.PI) / 180);
    const tiltY = ((Math.cos(t * 0.34 + 1.7) * tiltDeg * 0.7 * Math.PI) / 180);
    const lo_gx = gz * Math.sin(tiltX);
    const lo_gy = gz * Math.sin(tiltY);
    const lo_gz = gz * Math.cos(tiltX) * Math.cos(tiltY);

    for (const ch of [1, 2]) {
      const tr = this.trig[ch];
      if (tr.deployReady && t > tr.dtokExpiry) {
        tr.dtok = Math.floor(1000 + Math.random() * 9000);
        tr.dtokExpiry = t + 4.0;
      }
      if (tr.primeToken && t > tr.primeExpiry) {
        tr.primeToken = null;
      }
    }
    const baroDropout = Math.random() < 0.002; // ties the occasional "baro" preflight FAIL to the log line below
    const vals: Record<string, string | number> = {
      t_ms: Math.round(t * 1000),
      state,
      agl_m: alt.toFixed(2),
      alt_m: alt.toFixed(2),
      vel_ms: vel.toFixed(2),
      pressure_pa: baroPa(alt).toFixed(1),
      temp_c: (21.0 - alt * 0.0065).toFixed(2),
      hi_g: gz.toFixed(2),
      lo_g: Math.min(gz, 16.0).toFixed(2),
      lo_gx: lo_gx.toFixed(3),
      lo_gy: lo_gy.toFixed(3),
      lo_gz: lo_gz.toFixed(3),
      vbat: (this.vbat - t * 0.0006).toFixed(3),
      pyro_v: this.armed ? "7.40" : "7.41",
      armed: this.armed ? 1 : 0,
      cont1: this.fired[1] ? 0 : 1,
      cont2: this.fired[2] ? 0 : 1,
      dtok1: this.trig[1].dtok,
      dtok2: this.trig[2].dtok,
      // preflight-check booleans (see checks[]'s `check` fields above) —
      // the sim keeps these all-pass except a brief simulated baro dropout,
      // so a demo run has something to actually FAIL occasionally.
      pg: 1,
      baro_ok: baroDropout ? 0 : 1,
      accel_ok: 1,
      sd_ok: 1,
    };
    const kv = Object.entries(vals).map(([k, v]) => `${k}=${v}`).join(" ");
    this.emit(`TLM ${kv}`);
    if (baroDropout) this.emit(`LOG WARN baro2 brief dropout — using baro1`);
  }

  send(line: string) {
    setTimeout(() => this.handle(line.trim()), 15);
  }

  private handle(lineRaw: string) {
    // strip integrity suffix "... seq=N*HH" for the sim's own parsing purposes
    const line = lineRaw.replace(/\s+seq=\d+\*[0-9A-Fa-f]{2}\s*$/, "");
    if (line === "whoami") {
      this.emit(`FCD1 ${JSON.stringify(SIM_FCD)}`);
      return;
    }
    if (line === "get") {
      for (const [id, v] of Object.entries(this.params)) this.emit(`PARAM ${id}=${v}`);
      return;
    }
    const setM = /^set\s+(\w+)\s+(.+)$/.exec(line);
    if (setM) {
      const [, id, val] = setM;
      const spec = (SIM_FCD.params || []).find((p: ParamSpec) => p.id === id);
      if (!spec) {
        this.emit(`ERR unknown param ${id}`);
        return;
      }
      if (spec.type === "enum" && spec.values && !spec.values.includes(val)) {
        this.emit(`ERR range`);
        return;
      }
      if ((spec.type === "float" || spec.type === "int") && spec.min != null && (Number(val) < spec.min || Number(val) > spec.max!)) {
        this.emit(`ERR range`);
        return;
      }
      this.params[id] = spec.type === "int" ? String(Math.round(Number(val))) : val;
      if (id === "fire_mode") {
        this.fireMode = val;
        this.resetTrigger();
      }
      this.emit(`PARAM ${id}=${this.params[id]}`);
      return;
    }
    const doM = /^do\s+(\w+)\s*(.*)$/.exec(line);
    if (doM) {
      const [, action, argstr] = doM;
      const args: Record<string, string> = {};
      let m: RegExpExecArray | null;
      const re = /(\w+)=(\S+)/g;
      while ((m = re.exec(argstr)) !== null) args[m[1]] = m[2];
      this.doAction(action, args);
      return;
    }
    this.emit(`ERR unknown command`);
  }

  private resetTrigger() {
    this.trig = {
      1: { primeToken: null, primeExpiry: 0, deployReady: false, dtok: 0, dtokExpiry: 0 },
      2: { primeToken: null, primeExpiry: 0, deployReady: false, dtok: 0, dtokExpiry: 0 },
    };
    this.sessionKey = null;
  }

  private doAction(action: string, args: Record<string, string>) {
    const ch = Number(args.ch || 0);
    switch (action) {
      case "identify":
        // Mirrors the real board's "blink LED + chirp buzzer" identify
        // action — the sim has neither, so it just logs the event (the UI's
        // Identify control still visibly does something: a fresh LOG line
        // plus the ACK reply below).
        this.emit(`LOG INFO identify: blink+beep`);
        this.emit(`ACK identify ok`);
        return;
      case "flight_mode": {
        // Arms + starts logging in every mode. In `session` mode this is ALSO
        // the command that establishes the flight-wide pyro key (ground can
        // supply key=<n>, or leave blank and the board rolls one) — see
        // docs/fcd-protocol.md §7 Mode B ("do flight_mode [key=HHHH]").
        this.armed = true;
        if (this.fireMode === "session") {
          const key = args.key ? Number(args.key) : Math.floor(100000 + Math.random() * 899999);
          this.sessionKey = key;
          this.emit(`LOG INFO FLIGHT MODE — logging to SD started, session key set`);
          this.emit(`ACK flight_mode key=${key}`);
        } else {
          this.emit(`LOG INFO FLIGHT MODE — logging to SD started`);
          this.emit(`ACK flight_mode armed`);
        }
        return;
      }
      case "stop":
        this.armed = false;
        this.emit(`LOG INFO flight ended — log file closed`);
        this.emit(`ACK stop ended`);
        return;
      case "arm":
        this.armed = true;
        this.emit(`LOG WARN pyros ARMED`);
        this.emit(`ACK arm armed`);
        return;
      case "disarm":
        this.armed = false;
        this.resetTrigger();
        this.emit(`ACK disarm safe`);
        return;
      case "safe":
        this.resetTrigger();
        this.emit(`ACK safe cleared`);
        return;
      case "prime": {
        if (this.fireMode !== "safe") {
          this.emit(`ERR wrong mode (fire_mode=${this.fireMode})`);
          return;
        }
        if (!this.armed) {
          this.emit(`ERR not armed`);
          return;
        }
        if (!ch || ch < 1 || ch > 2) {
          this.emit(`ERR channel`);
          return;
        }
        const token = Math.floor(1000 + Math.random() * 9000);
        this.trig[ch].primeToken = token;
        this.trig[ch].primeExpiry = this.padT() + 10.0;
        this.emit(`ACK prime ch${ch} token=${token} window=10s`);
        return;
      }
      case "deploy_ready": {
        if (this.fireMode !== "hot") {
          this.emit(`ERR wrong mode (fire_mode=${this.fireMode})`);
          return;
        }
        if (!this.armed) {
          this.emit(`ERR not armed`);
          return;
        }
        if (!ch || ch < 1 || ch > 2) {
          this.emit(`ERR channel`);
          return;
        }
        this.trig[ch].deployReady = true;
        this.trig[ch].dtok = Math.floor(1000 + Math.random() * 9000);
        this.trig[ch].dtokExpiry = this.padT() + 4.0;
        this.emit(`ACK deploy_ready ch${ch}`);
        return;
      }
      case "fire": {
        if (!ch || ch < 1 || ch > 2) {
          this.emit(`ERR channel`);
          return;
        }
        if (!this.armed) {
          this.emit(`ERR not armed`);
          return;
        }
        if (this.fired[ch]) {
          this.emit(`ERR no continuity`);
          return;
        }
        const mode = this.fireMode;
        if (mode === "safe") {
          const tr = this.trig[ch];
          if (!tr.primeToken) {
            this.emit(`ERR not ready (prime first)`);
            return;
          }
          if (this.padT() > tr.primeExpiry) {
            this.emit(`ERR expired`);
            return;
          }
          if (String(args.token) !== String(tr.primeToken)) {
            this.emit(`ERR bad token`);
            return;
          }
          tr.primeToken = null;
        } else if (mode === "session") {
          if (this.sessionKey == null) {
            this.emit(`ERR not ready (set session key first)`);
            return;
          }
          if (String(args.token) !== String(this.sessionKey)) {
            this.emit(`ERR bad token`);
            return;
          }
        } else if (mode === "hot") {
          const tr = this.trig[ch];
          if (!tr.deployReady) {
            this.emit(`ERR not ready (deploy_ready first)`);
            return;
          }
          if (String(args.token) !== String(tr.dtok)) {
            this.emit(`ERR bad token`);
            return;
          }
        }
        // mode === "direct": no token required
        this.fired[ch] = true;
        this.emit(`LOG INFO pyro ch${ch} FIRED`);
        this.emit(`ACK fire ch${ch} fired`);
        return;
      }
      case "set_led":
        this.emit(`ACK set_led ${args.colour || "?"}`);
        return;
      case "zero_baro":
        this.emit(`ACK zero_baro done`);
        return;
      case "erase_logs":
        this.emit(`ACK erase_logs done`);
        return;
      default:
        this.emit(`ERR unknown action ${action}`);
    }
  }
}
