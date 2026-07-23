/**
 * sim.js — built-in FCD/1 mock board, so the dashboard can be demoed with no
 * hardware attached. Implements the same transport interface as
 * SerialTransport/WebSocketTransport (connect/send/onLine/onClose/disconnect)
 * so main.js treats it identically.
 *
 * Exercises every feature the dashboard renders: checks, rails, graphs,
 * params (including a `fire_mode` enum so all four pyro_trigger.h modes can be
 * demoed), actions, and a little deterministic flight model (mirrors
 * firmware/tools/gcs/adapters.py FlightModel) so the graphs/log pane have
 * something interesting to show.
 */

const SIM_FCD = {
  p: "fcd/1",
  name: "PROJECT OZONE (SIM)",
  sub: "UNSW Rocketry - Senior Flight Computer (STM32L452) - built-in demo board",
  fw: "0.1.0-sim",
  accent: "cyan",
  checks: [
    { id: "power", label: "Power" },
    { id: "baro", label: "Barometers" },
    { id: "accel", label: "Accelerometers" },
    { id: "sd", label: "SD card" },
    { id: "pyro", label: "Pyro continuity" },
  ],
  rails: [
    { id: "vbat", label: "Main batt", min: 6.4, max: 8.4, nom: 7.4 },
    { id: "pyro_v", label: "Pyro batt", min: 6.4, max: 8.4, nom: 7.4 },
  ],
  graphs: [
    { id: "agl_m", label: "Altitude AGL", unit: "m" },
    { id: "vel_ms", label: "Vertical vel", unit: "m/s" },
    { id: "hi_g", label: "Hi-g accel", unit: "g" },
    { id: "pressure_pa", label: "Pressure", unit: "Pa" },
  ],
  tlm: ["t_ms", "state", "agl_m", "alt_m", "vel_ms", "pressure_pa", "temp_c",
        "hi_g", "lo_g", "vbat", "pyro_v", "armed", "cont1", "cont2", "dtok1", "dtok2"],
  states: ["PAD", "BOOST", "COAST", "APOGEE", "DESCENT", "LANDED"],
  params: [
    { id: "fire_mode", label: "Pyro fire mode", type: "enum", value: "safe",
      values: ["safe", "session", "hot", "direct"] },
    { id: "apogee_vel", label: "Apogee detect vel", type: "float", value: 3.0, min: 0, max: 50, unit: "m/s" },
    { id: "launch_g", label: "Launch detect", type: "float", value: 3.0, min: 1, max: 30, unit: "g" },
    { id: "main_alt_m", label: "Main deploy alt", type: "int", value: 150, min: 0, max: 2000, unit: "m AGL" },
    { id: "vbat_div", label: "VBAT divider", type: "float", value: 4.49 },
    { id: "log_rate_hz", label: "Log rate", type: "int", value: 50, min: 1, max: 200, unit: "Hz" },
  ],
  actions: [
    { id: "flight_mode", label: "Enter flight mode", danger: true, confirm: "FLIGHT" },
    { id: "stop", label: "Stop / end flight (close log)", confirm: "STOP" },
    { id: "arm", label: "Arm pyros", confirm: "ARM" },
    { id: "disarm", label: "Disarm (make safe)" },
    { id: "prime", label: "Prime channel (safe mode)", danger: true,
      args: [{ id: "ch", label: "channel", type: "int", min: 1, max: 2 }] },
    { id: "session_key", label: "Set flight pyro key (session mode)",
      args: [{ id: "key", label: "key (blank = board rolls one)", type: "int", min: 0, max: 999999 }] },
    { id: "deploy_ready", label: "Deploy-ready (hot mode)", danger: true,
      args: [{ id: "ch", label: "channel", type: "int", min: 1, max: 2 }] },
    { id: "fire", label: "Fire", danger: true, confirm: "FIRE",
      args: [{ id: "ch", label: "channel", type: "int", min: 1, max: 2 }] },
    { id: "safe", label: "Cancel prime / deploy-ready / session" },
    { id: "set_led", label: "Set RGB LED",
      args: [{ id: "colour", label: "colour", type: "enum",
               values: ["off", "red", "green", "blue", "white", "cyan", "magenta", "yellow"] }] },
    { id: "zero_baro", label: "Zero barometer" },
    { id: "erase_logs", label: "Erase SD logs", danger: true, confirm: "ERASE" },
  ],
  caps: { pyro: 2, arm: true, logs: true, telemetry: true, integrity: true },
};

function baroPa(altM) {
  return 101325.0 * Math.pow(1.0 - 2.25577e-5 * Math.max(altM, 0), 5.25588);
}

class FlightModel {
  constructor({ apogeeM = 3000, burnS = 2.5, padS = 3.0 } = {}) {
    const g = 9.81;
    this.g = g;
    this.padS = padS;
    this.burn = burnS;
    this.A = Math.sqrt(2 * g * apogeeM) / burnS;
    this.vBurnout = this.A * burnS;
    this.boostH = 0.5 * this.A * burnS * burnS;
    this.tApogee = padS + burnS + this.vBurnout / g;
    this.apogeeH = this.boostH + (this.vBurnout * this.vBurnout) / (2 * g);
  }

  at(t) {
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

export class SimTransport {
  constructor() {
    this.label = "SIMULATOR (no hardware)";
    this._lineHandlers = [];
    this._closeHandlers = [];
    this._t0 = null;
    this._timer = null;
    this._launched = false;
    this._launchAt = 4.0; // auto-launch after 4s of pad time, demo-style
    this.model = new FlightModel({});
    this.armed = false;
    this.vbat = 7.82;
    this.params = Object.fromEntries(SIM_FCD.params.map((p) => [p.id, p.value]));
    this.fireMode = this.params.fire_mode;
    // pyro trigger state, mirrors pyro_trigger.h
    this.trig = {
      1: { primeToken: null, primeExpiry: 0, deployReady: false, dtok: 0, dtokExpiry: 0 },
      2: { primeToken: null, primeExpiry: 0, deployReady: false, dtok: 0, dtokExpiry: 0 },
    };
    this.sessionKey = null;
    this.fired = { 1: false, 2: false };
    this._seq = 0;
  }

  onLine(fn) { this._lineHandlers.push(fn); }
  onClose(fn) { this._closeHandlers.push(fn); }

  _emit(line) { this._lineHandlers.forEach((f) => f(line)); }

  async connect() {
    this._t0 = performance.now() / 1000;
    this._timer = setInterval(() => this._tick(), 100);
    return true;
  }

  async disconnect() {
    clearInterval(this._timer);
    this._closeHandlers.forEach((f) => f("simulator stopped"));
  }

  _padT() {
    return performance.now() / 1000 - this._t0;
  }

  _tick() {
    const t = this._padT();
    if (!this._launched && t >= this._launchAt) {
      this._launched = true;
      this._emit(`LOG INFO liftoff detected`);
      this._flightT0 = t;
    }
    let alt, vel, state, gz;
    if (!this._launched) {
      alt = (Math.random() - 0.5) * 0.6;
      vel = (Math.random() - 0.5) * 0.4;
      state = "PAD";
      gz = 1.0 + (Math.random() - 0.5) * 0.04;
    } else {
      const ft = t - this._flightT0;
      const m = this.model.at(this.model.padS + ft);
      alt = m.alt; vel = m.vel; state = m.state; gz = m.gz;
      if (state !== this._lastState) {
        this._lastState = state;
        const evs = {
          BOOST: "liftoff confirmed - boosting",
          COAST: "motor burnout - coasting",
          APOGEE: `apogee detected (${alt.toFixed(0)} m)`,
          DESCENT: "drogue/main deploy sequence",
          LANDED: "landed - recovery beacon ON",
        };
        if (evs[state]) this._emit(`LOG INFO ${evs[state]}`);
      }
    }
    // rolling hot-mode tokens
    for (const ch of [1, 2]) {
      const tr = this.trig[ch];
      if (tr.deployReady && t > tr.dtokExpiry) {
        tr.dtok = Math.floor(1000 + Math.random() * 9000);
        tr.dtokExpiry = t + 4.0; // rotates every ~4s
      }
      if (tr.primeToken && t > tr.primeExpiry) {
        tr.primeToken = null; // window expired
      }
    }
    const vals = {
      t_ms: Math.round(t * 1000), state,
      agl_m: alt.toFixed(2), alt_m: alt.toFixed(2), vel_ms: vel.toFixed(2),
      pressure_pa: baroPa(alt).toFixed(1), temp_c: (21.0 - alt * 0.0065).toFixed(2),
      hi_g: gz.toFixed(2), lo_g: Math.min(gz, 16.0).toFixed(2),
      vbat: (this.vbat - t * 0.0006).toFixed(3),
      pyro_v: this.armed ? "7.40" : "7.41",
      armed: this.armed ? 1 : 0,
      cont1: this.fired[1] ? 0 : 1,
      cont2: this.fired[2] ? 0 : 1,
      dtok1: this.trig[1].dtok, dtok2: this.trig[2].dtok,
    };
    const kv = Object.entries(vals).map(([k, v]) => `${k}=${v}`).join(" ");
    this._emit(`TLM ${kv}`);
    if (Math.random() < 0.002) this._emit(`LOG WARN baro2 brief dropout - using baro1`);
  }

  send(line) {
    // Reply asynchronously (microtask) like a real link would, so callers
    // that "await" a reply see it arrive after send() returns.
    setTimeout(() => this._handle(line.trim()), 15);
  }

  _handle(lineRaw) {
    // strip integrity suffix "... seq=N*HH" for the sim's own parsing purposes
    const line = lineRaw.replace(/\s+seq=\d+\*[0-9A-Fa-f]{2}\s*$/, "");
    if (line === "whoami") {
      this._emit(`FCD1 ${JSON.stringify(SIM_FCD)}`);
      return;
    }
    if (line === "get") {
      for (const [id, v] of Object.entries(this.params)) this._emit(`PARAM ${id}=${v}`);
      return;
    }
    const setM = /^set\s+(\w+)\s+(.+)$/.exec(line);
    if (setM) {
      const [, id, val] = setM;
      const spec = SIM_FCD.params.find((p) => p.id === id);
      if (!spec) { this._emit(`ERR unknown param ${id}`); return; }
      if (spec.type === "enum" && spec.values && !spec.values.includes(val)) {
        this._emit(`ERR range`); return;
      }
      if ((spec.type === "float" || spec.type === "int") && spec.min != null &&
          (Number(val) < spec.min || Number(val) > spec.max)) {
        this._emit(`ERR range`); return;
      }
      this.params[id] = spec.type === "int" ? String(Math.round(Number(val))) : val;
      if (id === "fire_mode") { this.fireMode = val; this._resetTrigger(); }
      this._emit(`PARAM ${id}=${this.params[id]}`);
      return;
    }
    const doM = /^do\s+(\w+)\s*(.*)$/.exec(line);
    if (doM) {
      const [, action, argstr] = doM;
      const args = {};
      let m; const re = /(\w+)=(\S+)/g;
      while ((m = re.exec(argstr)) !== null) args[m[1]] = m[2];
      this._doAction(action, args);
      return;
    }
    this._emit(`ERR unknown command`);
  }

  _resetTrigger() {
    this.trig = {
      1: { primeToken: null, primeExpiry: 0, deployReady: false, dtok: 0, dtokExpiry: 0 },
      2: { primeToken: null, primeExpiry: 0, deployReady: false, dtok: 0, dtokExpiry: 0 },
    };
    this.sessionKey = null;
  }

  _doAction(action, args) {
    const ch = Number(args.ch || 0);
    switch (action) {
      case "flight_mode":
        this.armed = true;
        this._emit(`LOG INFO FLIGHT MODE - logging to SD started`);
        this._emit(`ACK flight_mode armed`);
        return;
      case "stop":
        this.armed = false;
        this._emit(`LOG INFO flight ended - log file closed`);
        this._emit(`ACK stop ended`);
        return;
      case "arm":
        this.armed = true;
        this._emit(`LOG WARN pyros ARMED`);
        this._emit(`ACK arm armed`);
        return;
      case "disarm":
        this.armed = false;
        this._resetTrigger();
        this._emit(`ACK disarm safe`);
        return;
      case "safe":
        this._resetTrigger();
        this._emit(`ACK safe cleared`);
        return;
      case "prime": {
        if (this.fireMode !== "safe") { this._emit(`ERR wrong mode (fire_mode=${this.fireMode})`); return; }
        if (!this.armed) { this._emit(`ERR not armed`); return; }
        if (!ch || ch < 1 || ch > 2) { this._emit(`ERR channel`); return; }
        const token = Math.floor(1000 + Math.random() * 9000);
        this.trig[ch].primeToken = token;
        this.trig[ch].primeExpiry = this._padT() + 10.0;
        this._emit(`ACK prime ch${ch} token=${token} window=10s`);
        return;
      }
      case "session_key": {
        if (this.fireMode !== "session") { this._emit(`ERR wrong mode (fire_mode=${this.fireMode})`); return; }
        if (!this.armed) { this._emit(`ERR not armed`); return; }
        const key = args.key ? Number(args.key) : Math.floor(100000 + Math.random() * 899999);
        this.sessionKey = key;
        this._emit(`ACK session_key key=${key}`);
        return;
      }
      case "deploy_ready": {
        if (this.fireMode !== "hot") { this._emit(`ERR wrong mode (fire_mode=${this.fireMode})`); return; }
        if (!this.armed) { this._emit(`ERR not armed`); return; }
        if (!ch || ch < 1 || ch > 2) { this._emit(`ERR channel`); return; }
        this.trig[ch].deployReady = true;
        this.trig[ch].dtok = Math.floor(1000 + Math.random() * 9000);
        this.trig[ch].dtokExpiry = this._padT() + 4.0;
        this._emit(`ACK deploy_ready ch${ch}`);
        return;
      }
      case "fire": {
        if (!ch || ch < 1 || ch > 2) { this._emit(`ERR channel`); return; }
        if (!this.armed) { this._emit(`ERR not armed`); return; }
        if (this.fired[ch]) { this._emit(`ERR no continuity`); return; }
        const mode = this.fireMode;
        if (mode === "safe") {
          const tr = this.trig[ch];
          if (!tr.primeToken) { this._emit(`ERR not ready (prime first)`); return; }
          if (this._padT() > tr.primeExpiry) { this._emit(`ERR expired`); return; }
          if (String(args.token) !== String(tr.primeToken)) { this._emit(`ERR bad token`); return; }
          tr.primeToken = null;
        } else if (mode === "session") {
          if (this.sessionKey == null) { this._emit(`ERR not ready (set session key first)`); return; }
          if (String(args.token) !== String(this.sessionKey)) { this._emit(`ERR bad token`); return; }
        } else if (mode === "hot") {
          const tr = this.trig[ch];
          if (!tr.deployReady) { this._emit(`ERR not ready (deploy_ready first)`); return; }
          if (String(args.token) !== String(tr.dtok)) { this._emit(`ERR bad token`); return; }
        } else if (mode === "direct") {
          // no token required
        }
        this.fired[ch] = true;
        this._emit(`LOG INFO pyro ch${ch} FIRED`);
        this._emit(`ACK fire ch${ch} fired`);
        return;
      }
      case "set_led":
        this._emit(`ACK set_led ${args.colour || "?"}`);
        return;
      case "zero_baro":
        this._emit(`ACK zero_baro done`);
        return;
      case "erase_logs":
        this._emit(`ACK erase_logs done`);
        return;
      default:
        this._emit(`ERR unknown action ${action}`);
    }
  }
}
