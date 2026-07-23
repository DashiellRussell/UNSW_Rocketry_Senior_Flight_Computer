/**
 * pyro.js — the pyro control panel: arm/disarm + the operator-side handshake
 * for all four fire_mode variants from pyro_trigger.h (safe/session/hot/direct).
 *
 * The board is always the source of truth (it rejects `fire` unless armed,
 * key-switch closed, continuity present, etc — see PROTOCOL.md §4). This
 * panel only adds the OPERATOR-side guard on top: typed FIRE/ARM confirmation,
 * red danger styling, hold-to-fire for the fast/least-safe mode, and refuses
 * to even attempt a fire the UI can already see is hopeless (no continuity).
 *
 * FCD ambiguity resolved here (see README): the protocol docs don't give a
 * `do` id for entering SESSION mode's flight key, so this UI calls it
 * `session_key` with an optional `key=` arg (blank = board rolls one). If the
 * real firmware ends up using a different action id, only PYRO_ACTION_IDS
 * below (and boards.py-equivalent) need to change.
 */
import { el, openConfirmModal } from "./ui.js";

export class PyroPanel {
  constructor(profile, api) {
    this.profile = profile;
    this.api = api; // { doAction(id,args)->Promise<replyText>, integrityNote }
    this.host = document.getElementById("pyroPanel");
    this.channels = Math.max(0, Number(profile.caps?.pyro || 0));
    this.fireModeParam = profile.params.find((p) => p.id === "fire_mode");
    this.mode = this.fireModeParam ? String(this.fireModeParam.value) : "direct";
    this.armed = false;
    this.cont = {};
    this.dtok = {};
    this.primeToken = {}; // ch -> {token, expiresAt}
    this.sessionKey = null;
    this._tickHandle = null;
    this._render();
  }

  destroy() {
    if (this._tickHandle) clearInterval(this._tickHandle);
  }

  setMode(mode) {
    this.mode = mode;
    this.primeToken = {};
    this.sessionKey = null;
    this._render();
  }

  setArmed(armed) {
    this.armed = armed;
    this._render();
  }

  updateTelemetry(vals) {
    let changed = false;
    for (let ch = 1; ch <= this.channels; ch++) {
      if (`cont${ch}` in vals) {
        const c = !!vals[`cont${ch}`];
        if (this.cont[ch] !== c) { this.cont[ch] = c; changed = true; }
      }
      if (`dtok${ch}` in vals) {
        const d = Number(vals[`dtok${ch}`]);
        if (this.dtok[ch] !== d) { this.dtok[ch] = d; changed = true; }
      }
    }
    if ("armed" in vals) {
      const a = !!vals.armed;
      if (this.armed !== a) { this.armed = a; changed = true; }
    }
    if (changed) this._render();
  }

  _render() {
    const host = this.host;
    host.innerHTML = "";
    if (this.channels === 0) {
      host.appendChild(el("div", "empty-hint", "Board has no pyro channels (caps.pyro=0)."));
      return;
    }

    // header row: armed pill + arm/disarm + mode indicator
    const head = el("div", "pyro-head");
    const pill = el("span", `armed-pill ${this.armed ? "armed" : "safe"}`, this.armed ? "ARMED" : "SAFE");
    head.appendChild(pill);
    const armBtn = el("button", `btn ${this.armed ? "" : "btn-primary"}`, this.armed ? "Disarm" : "Arm pyros");
    armBtn.onclick = () => {
      if (this.armed) {
        this.api.doAction("disarm", {}).then((r) => this._toast(r));
      } else {
        openConfirmModal({
          title: "Arm pyros", token: "ARM", danger: true,
          body: "External key switch must also be closed — software cannot fire without it.",
          onConfirm: () => this.api.doAction("arm", {}).then((r) => this._toast(r)),
        });
      }
    };
    head.appendChild(armBtn);

    if (this.fireModeParam && this.fireModeParam.values) {
      const modeWrap = el("span", "mode-tag");
      modeWrap.appendChild(document.createTextNode("fire_mode: "));
      const sel = document.createElement("select");
      sel.className = "mode-select";
      for (const v of this.fireModeParam.values) {
        const opt = el("option", "", v);
        opt.value = v;
        if (v === this.mode) opt.selected = true;
        sel.appendChild(opt);
      }
      sel.onchange = async () => {
        const reply = await this.api.setParam("fire_mode", sel.value);
        this._toast(reply);
        // main.js applies setMode() once the board ACKs via PARAM; if it
        // didn't (e.g. rejected), snap the select back to the live mode.
        if (!reply.startsWith("PARAM")) sel.value = this.mode;
      };
      modeWrap.appendChild(sel);
      head.appendChild(modeWrap);
    } else {
      head.appendChild(el("span", "mode-tag", `fire_mode: ${this.mode} (read-only — board declared no fire_mode param)`));
    }
    host.appendChild(head);

    if (this.mode === "session") host.appendChild(this._sessionRow());

    const grid = el("div", "pyro-grid");
    for (let ch = 1; ch <= this.channels; ch++) grid.appendChild(this._channelCard(ch));
    host.appendChild(grid);
  }

  _sessionRow() {
    const row = el("div", "session-row");
    row.appendChild(el("span", "session-label", "Flight pyro key:"));
    const val = el("span", "session-key", this.sessionKey == null ? "(not set)" : String(this.sessionKey));
    const input = document.createElement("input");
    input.className = "modal-input session-input";
    input.placeholder = "blank = board rolls one";
    const btn = el("button", "btn btn-small", "Set key");
    btn.onclick = async () => {
      if (!this.armed) { this._toast("ERR must arm first"); return; }
      const args = input.value.trim() ? { key: input.value.trim() } : {};
      const reply = await this.api.doAction("session_key", args);
      const m = /key=(\S+)/.exec(reply);
      if (m) { this.sessionKey = m[1]; val.textContent = m[1]; }
      this._toast(reply);
    };
    row.append(val, input, btn);
    return row;
  }

  _channelCard(ch) {
    const card = el("div", "pyro-card");
    const cont = this.cont[ch];
    const top = el("div", "pyro-card-top");
    top.append(
      el("span", "pyro-ch", `CH ${ch}`),
      el("span", `cont-dot ${cont ? "ok" : "bad"}`, cont ? "CONT" : "OPEN")
    );
    card.appendChild(top);

    const canFireGate = this.armed && cont;
    if (!canFireGate) {
      card.appendChild(el("div", "pyro-blocked",
        !this.armed ? "blocked — arm first" : "blocked — no continuity"));
    }

    if (this.mode === "safe") {
      card.appendChild(this._safeControls(ch, canFireGate));
    } else if (this.mode === "session") {
      card.appendChild(this._sessionControls(ch, canFireGate));
    } else if (this.mode === "hot") {
      card.appendChild(this._hotControls(ch, canFireGate));
    } else {
      card.appendChild(this._directControls(ch, canFireGate));
    }
    return card;
  }

  // Mode A — safe: prime -> shows token -> typed-FIRE with that token.
  _safeControls(ch, canFireGate) {
    const wrap = el("div", "mode-controls");
    const pt = this.primeToken[ch];
    const primeBtn = el("button", "btn btn-small", pt ? "re-prime" : "Prime");
    primeBtn.disabled = !canFireGate;
    primeBtn.onclick = async () => {
      const reply = await this.api.doAction("prime", { ch });
      const tm = /token=(\d+)/.exec(reply);
      const wm = /window=(\d+)s/.exec(reply);
      if (tm) {
        this.primeToken[ch] = { token: tm[1], expiresAt: Date.now() + (wm ? Number(wm[1]) : 10) * 1000 };
        this._render();
      } else {
        this._toast(reply);
      }
    };
    wrap.appendChild(primeBtn);
    if (pt) {
      const remaining = Math.max(0, Math.round((pt.expiresAt - Date.now()) / 1000));
      wrap.appendChild(el("div", "token-display", `token ${pt.token} · ${remaining}s`));
      const fireBtn = el("button", "btn btn-danger", "FIRE");
      fireBtn.disabled = remaining <= 0;
      fireBtn.onclick = () => {
        openConfirmModal({
          title: `Fire channel ${ch}`, token: "FIRE", danger: true,
          body: `Uses one-shot token ${pt.token} from the prime step.`,
          onConfirm: async () => {
            const reply = await this.api.doAction("fire", { ch, token: pt.token });
            this.primeToken[ch] = null;
            this._toast(reply);
            this._render();
          },
        });
      };
      wrap.appendChild(fireBtn);
      if (!this._tickHandle) this._tickHandle = setInterval(() => this._render(), 1000);
    }
    return wrap;
  }

  // Mode B — session: one flight-wide key, one-command fire (no prime step).
  _sessionControls(ch, canFireGate) {
    const wrap = el("div", "mode-controls");
    const fireBtn = el("button", "btn btn-danger", "FIRE");
    fireBtn.disabled = !canFireGate || this.sessionKey == null;
    fireBtn.onclick = () => {
      openConfirmModal({
        title: `Fire channel ${ch}`, token: "FIRE", danger: true,
        body: `Uses the session flight key (${this.sessionKey}).`,
        onConfirm: async () => {
          const reply = await this.api.doAction("fire", { ch, token: this.sessionKey });
          this._toast(reply);
        },
      });
    };
    wrap.appendChild(fireBtn);
    if (this.sessionKey == null) wrap.appendChild(el("div", "hint-text", "set the flight key above first"));
    return wrap;
  }

  // Mode C — hot: deploy-ready latches a rolling token streamed in telemetry;
  // fire is a single guarded keypress that auto-fills the current token.
  _hotControls(ch, canFireGate) {
    const wrap = el("div", "mode-controls");
    const ready = this.dtok[ch] > 0;
    const readyBtn = el("button", "btn btn-small", ready ? "deploy-ready ✓" : "Deploy-ready");
    readyBtn.disabled = !canFireGate || ready;
    readyBtn.onclick = async () => {
      const reply = await this.api.doAction("deploy_ready", { ch });
      this._toast(reply);
    };
    wrap.appendChild(readyBtn);
    if (ready) {
      wrap.appendChild(el("div", "token-display live-token", `live token ${this.dtok[ch]}`));
      const fireBtn = el("button", "btn btn-danger btn-hot", "FIRE (armed hotkey)");
      fireBtn.onclick = () => {
        openConfirmModal({
          title: `Fire channel ${ch} — HOT`, token: "FIRE", danger: true,
          body: `Auto-fills the current rolling token (${this.dtok[ch]}). Meant for a single guarded keypress in an emergency.`,
          onConfirm: async () => {
            const reply = await this.api.doAction("fire", { ch, token: this.dtok[ch] });
            this._toast(reply);
          },
        });
      };
      wrap.appendChild(fireBtn);
    }
    return wrap;
  }

  // Mode D — direct: fastest, least safe. No token; operator-side hold-to-fire
  // is the only extra guard, since the board itself has no interlock beyond
  // armed + continuity + key switch.
  _directControls(ch, canFireGate) {
    const wrap = el("div", "mode-controls");
    const btn = el("button", "btn btn-danger btn-hold", "HOLD TO FIRE");
    btn.disabled = !canFireGate;
    const ring = el("div", "hold-ring");
    btn.appendChild(ring);
    let holdTimer = null, holdStart = 0;
    const HOLD_MS = 1400;
    const cancel = () => {
      clearInterval(holdTimer); holdTimer = null;
      ring.style.width = "0%";
      btn.classList.remove("holding");
    };
    const start = () => {
      if (btn.disabled) return;
      btn.classList.add("holding");
      holdStart = Date.now();
      holdTimer = setInterval(() => {
        const pct = Math.min(100, ((Date.now() - holdStart) / HOLD_MS) * 100);
        ring.style.width = pct + "%";
        if (pct >= 100) {
          cancel();
          this.api.doAction("fire", { ch }).then((r) => this._toast(r));
        }
      }, 30);
    };
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", cancel);
    btn.addEventListener("pointerleave", cancel);
    wrap.appendChild(btn);
    wrap.appendChild(el("div", "hint-text", "no token in this mode — hold ~1.4s to fire"));
    return wrap;
  }

  _toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.remove("show"); void t.offsetWidth; t.classList.add("show");
  }
}
