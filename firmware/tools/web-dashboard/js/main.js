/**
 * main.js — app glue: connect flow, FCD handshake, line routing, command
 * dispatch. This is the only file that "knows" about all the others; nothing
 * here is board-specific — everything comes from the descriptor.
 */
import * as fcd from "./fcd.js";
import * as ui from "./ui.js";
import { PyroPanel } from "./pyro.js";
import { SerialTransport, WebSocketTransport } from "./transports.js";
import { SimTransport } from "./sim.js";

// Safety-relevant actions that get command-integrity framing (CRC + seq) when
// the descriptor's caps.integrity is truthy. Per docs/telecom-command-protocol.md
// §"Command integrity": arm/deploy_ready/prime/fire. session_key/disarm/safe are
// added here too since they gate the same handshake state — see README ambiguities.
const SAFETY_ACTIONS = new Set(["arm", "disarm", "prime", "fire", "deploy_ready", "session_key", "safe"]);

const GENERIC_PROFILE = {
  p: "fcd/1", name: "UNKNOWN BOARD", sub: "no FCD1 descriptor received — generic fallback",
  fw: "", accent: "white", checks: [], rails: [], graphs: [], tlm: [], params: [], actions: [],
  states: ["PAD", "BOOST", "COAST", "APOGEE", "DESCENT", "LANDED"], caps: {},
};

function normaliseProfile(m) {
  const p = JSON.parse(JSON.stringify(m));
  p.checks = p.checks || []; p.rails = p.rails || []; p.graphs = p.graphs || [];
  p.params = p.params || []; p.actions = p.actions || []; p.tlm = p.tlm || [];
  p.caps = p.caps || {};
  p.hasPyro = Number(p.caps.pyro || 0) > 0;
  return p;
}

class App {
  constructor() {
    this.transport = null;
    this.profile = null;
    this.pending = []; // resolvers waiting for the next ACK/ERR/PARAM line
    this.seq = 0;
    this.checksState = {};
    this.railsState = {};
    this.graphs = {};
    this.logState = null;
    this.pyro = null;
    this.lastTlm = {};
    this.t0 = performance.now() / 1000;
    this.connected = false;
    this._bindConnectBar();
  }

  _bindConnectBar() {
    const kindSel = document.getElementById("transportKind");
    const wsRow = document.getElementById("wsUrlRow");
    const baudRow = document.getElementById("baudRow");
    kindSel.addEventListener("change", () => {
      wsRow.style.display = kindSel.value === "ws" ? "flex" : "none";
      baudRow.style.display = kindSel.value === "serial" ? "flex" : "none";
    });
    document.getElementById("connectBtn").addEventListener("click", () => this.connect());
    document.getElementById("disconnectBtn").addEventListener("click", () => this.disconnect());
    if (!SerialTransport.available) {
      const opt = [...kindSel.options].find((o) => o.value === "serial");
      if (opt) opt.textContent += " (unavailable in this browser)";
    }
  }

  _setStatus(text, cls) {
    const s = document.getElementById("statusPill");
    s.textContent = text;
    s.className = `status-pill ${cls || ""}`;
  }

  async connect() {
    const kind = document.getElementById("transportKind").value;
    document.getElementById("connectBtn").disabled = true;
    try {
      if (kind === "serial") {
        const baud = Number(document.getElementById("baudInput").value || 115200);
        this.transport = new SerialTransport(baud);
      } else if (kind === "ws") {
        const url = document.getElementById("wsUrlInput").value.trim();
        if (!url) throw new Error("enter a WebSocket URL, e.g. ws://192.168.4.1:81");
        this.transport = new WebSocketTransport(url);
      } else {
        this.transport = new SimTransport();
      }
      this._setStatus("connecting…", "connecting");
      this.transport.onLine((l) => this._onLine(l));
      this.transport.onClose((reason) => this._onClose(reason));
      await this.transport.connect();
      this._setStatus(`link up (${this.transport.label})`, "up");
      await this._handshake();
      this.connected = true;
      document.getElementById("connectBar").classList.add("connected");
      document.getElementById("disconnectBtn").style.display = "";
    } catch (e) {
      this._setStatus(`failed: ${e.message}`, "down");
      this.transport = null;
    } finally {
      document.getElementById("connectBtn").disabled = false;
    }
  }

  async disconnect() {
    if (this.transport) await this.transport.disconnect();
    this._onClose("disconnected by operator");
  }

  _onClose(reason) {
    this.connected = false;
    this._setStatus(reason || "disconnected", "down");
    document.getElementById("connectBar").classList.remove("connected");
    document.getElementById("disconnectBtn").style.display = "none";
    if (this.pyro) { this.pyro.destroy(); this.pyro = null; }
  }

  async _handshake() {
    document.getElementById("waitingScreen").style.display = "";
    document.getElementById("dashboard").style.display = "none";
    this.transport.send("whoami");
    const descriptor = await new Promise((resolve) => {
      let done = false;
      const handler = (line) => {
        const d = fcd.parseDescriptor(line);
        if (d && !done) { done = true; resolve(d); }
      };
      this.transport.onLine(handler);
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 1500);
    });
    this._buildFromDescriptor(descriptor || GENERIC_PROFILE, !descriptor);
  }

  _buildFromDescriptor(raw, fellBack) {
    this.profile = normaliseProfile(raw);
    document.getElementById("waitingScreen").style.display = "none";
    document.getElementById("dashboard").style.display = "";
    document.getElementById("fallbackNote").style.display = fellBack ? "" : "none";

    ui.renderHeader(this.profile);
    this.checksState = ui.buildChecks(this.profile);
    this.railsState = ui.buildRails(this.profile);
    this.graphs = ui.buildGraphs(this.profile);
    this.logState = ui.initLog();
    ui.buildParams(this.profile, (id, val) => this._setParam(id, val));
    ui.buildActions(this.profile, (id, args, btn) => this._invoke(id, args, btn));
    if (this.profile.hasPyro) {
      document.getElementById("pyroSection").style.display = "";
      this.pyro = new PyroPanel(this.profile, {
        doAction: (id, args) => this._invoke(id, args),
        setParam: (id, val) => this._setParam(id, val),
      });
    } else {
      document.getElementById("pyroSection").style.display = "none";
    }
    const capsStr = Object.entries(this.profile.caps).map(([k, v]) => `${k}=${v}`).join(" ");
    document.getElementById("capsLine").textContent = capsStr ? `caps: ${capsStr}` : "";
  }

  _onLine(line) {
    if (!line) return;
    // re-handshake if the board re-announces itself (reboot, mode change etc.)
    if (line.startsWith("FCD1 ")) {
      const d = fcd.parseDescriptor(line);
      if (d) this._buildFromDescriptor(d, false);
      return;
    }
    const logEv = fcd.parseLog(line);
    if (logEv) {
      const t = (performance.now() / 1000 - this.t0).toFixed(1) + "s";
      ui.appendLogLine(this.logState, logEv.level, logEv.msg, t);
      this._resolvePending(line);
      return;
    }
    const tlm = fcd.parseTelemetry(line);
    if (tlm && (line.startsWith("TLM") || "state" in tlm || "agl_m" in tlm || "alt_m" in tlm)) {
      this._onTelemetry(tlm);
      return;
    }
    // ACK / ERR / PARAM replies
    this._resolvePending(line);
  }

  _onTelemetry(vals) {
    this.lastTlm = { ...this.lastTlm, ...vals };
    const t = "t_ms" in vals ? Number(vals.t_ms) / 1000 : performance.now() / 1000 - this.t0;
    for (const g of this.profile.graphs) {
      if (g.id in vals) ui.pushGraphSample(this.graphs, g.id, t, Number(vals[g.id]));
    }
    for (const r of this.profile.rails) {
      if (r.id in vals) ui.updateRail(this.railsState, r.id, Number(vals[r.id]));
    }
    this._inferChecks(vals);
    if (this.pyro) this.pyro.updateTelemetry(vals);
    if ("state" in vals) document.getElementById("flightState").textContent = vals.state;
    // live fire_mode reflect (in case set elsewhere / persisted on board)
  }

  // Heuristic: PROTOCOL.md's checks[] have no defined live wire representation
  // in fcd/1 (no CHECK line type — see README "FCD ambiguities"). We infer
  // pass/warn/fail from whatever telemetry/rails already tell us, so checks
  // still turn green live during preflight instead of sitting at "pending"
  // forever. A board can also just emit `LOG INFO check:<id> pass` lines,
  // which "_resolvePending"/log parsing will surface in the event log either way.
  _inferChecks(vals) {
    for (const c of this.profile.checks) {
      if (c.id in vals) {
        const v = vals[c.id];
        ui.setCheckStatus(this.checksState, c.id, v ? "pass" : "fail", v ? "ok" : "reported not-ok");
        continue;
      }
      if ((c.id === "power" || c.id === "vbat") && "vbat" in vals) {
        const rail = this.profile.rails.find((r) => r.id === "vbat");
        if (rail) {
          const ok = vals.vbat >= rail.min && vals.vbat <= rail.max;
          ui.setCheckStatus(this.checksState, c.id, ok ? "pass" : "fail", `${Number(vals.vbat).toFixed(2)} V`);
        }
      }
      if (c.id === "pyro" && this.profile.hasPyro) {
        const conts = [];
        for (let i = 1; i <= this.profile.caps.pyro; i++) if (`cont${i}` in vals) conts.push(!!vals[`cont${i}`]);
        if (conts.length) {
          const allOk = conts.every(Boolean);
          ui.setCheckStatus(this.checksState, c.id, allOk ? "pass" : "warn",
            `cont ${conts.filter(Boolean).length}/${conts.length}`);
        }
      }
      if (c.id === "baro" && "pressure_pa" in vals) {
        ui.setCheckStatus(this.checksState, c.id, "pass", `${Number(vals.pressure_pa).toFixed(0)} Pa`);
      }
    }
  }

  // ── command dispatch (do / set) with optional integrity framing ───────────
  _resolvePending(line) {
    if (!this.pending.length) return;
    const resolve = this.pending.shift();
    resolve(line);
  }

  _awaitReply(timeoutMs = 2000) {
    return new Promise((resolve) => {
      let done = false;
      const wrapped = (line) => { if (!done) { done = true; resolve(line); } };
      this.pending.push(wrapped);
      setTimeout(() => {
        if (!done) {
          done = true;
          const idx = this.pending.indexOf(wrapped);
          if (idx >= 0) this.pending.splice(idx, 1);
          resolve("(no reply)");
        }
      }, timeoutMs);
    });
  }

  async _invoke(actionId, args, btn) {
    if (!this.connected) return "ERR not connected";
    const integrity = !!this.profile.caps.integrity && SAFETY_ACTIONS.has(actionId);
    const line = fcd.buildCommand("do", actionId, fcd.fmtArgs(args), {
      integrity, seq: integrity ? ++this.seq : undefined,
    });
    if (btn) btn.disabled = true;
    this.transport.send(line);
    const reply = await this._awaitReply();
    if (btn) btn.disabled = false;
    return reply;
  }

  async _setParam(id, value) {
    if (!this.connected) return "ERR not connected";
    const spec = this.profile.params.find((p) => p.id === id);
    let v = value;
    if (spec && spec.type === "bool") v = value === "on" ? "1" : "0";
    const line = fcd.buildCommand("set", id, v, {});
    this.transport.send(line);
    const reply = await this._awaitReply();
    if (id === "fire_mode" && reply.startsWith("PARAM") && this.pyro) {
      const m = fcd.parseParamReply(reply);
      if (m) this.pyro.setMode(String(m.value));
    }
    return reply;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.__app = new App();
});
