"use client";

/**
 * useFcdConnection — app glue: connect flow, FCD handshake, line routing,
 * command dispatch. Ported from firmware/tools/web-dashboard/js/main.js.
 * Nothing here is board-specific — everything comes from the descriptor.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as fcd from "@/lib/fcd";
import { GENERIC_PROFILE, normaliseProfile, type Profile, type CheckStatus, type TlmFrame } from "@/lib/types";
import { SerialTransport, WebSocketTransport, type Transport } from "@/lib/transports";
import { SimTransport } from "@/lib/sim";
import { GraphBus } from "@/lib/bus";

export type TransportKind = "serial" | "ws" | "sim";

export interface ConnectOptions {
  baud?: number;
  wsUrl?: string;
}

export type StatusClass = "idle" | "connecting" | "up" | "down";

export interface LogLine {
  id: number;
  level: fcd.LogLevel;
  msg: string;
  t: string;
}

export interface CheckState {
  status: CheckStatus;
  detail: string;
}

export interface RailState {
  value: number;
  pct: number;
  /** "off": battery rail reading ~0V — no battery connected, NOT an error
   *  (USB-powered boards legitimately have no battery plugged in). Only
   *  "bad"/"warn" once a rail is actually reading a real battery voltage
   *  that's out of range. */
  cls: "ok" | "warn" | "bad" | "off";
}

/** Below this, a battery rail reads as "no battery connected" (muted grey)
 *  rather than a red/amber out-of-range alarm — 0V from an unplugged
 *  battery is expected, not a fault. */
const RAIL_NO_BATT_V = 1.0;

export interface PyroChannelState {
  cont: boolean | null;
  dtok: number;
}

const LOG_MAX = 400;

function fmtT(t0: number) {
  return (performance.now() / 1000 - t0).toFixed(1) + "s";
}

export function useFcdConnection() {
  const [status, setStatusState] = useState<{ text: string; cls: StatusClass }>({
    text: "not connected",
    cls: "idle",
  });
  const [connected, setConnected] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [fellBack, setFellBack] = useState(false);
  const [transportLabel, setTransportLabel] = useState("");
  const [isSim, setIsSim] = useState(false);

  // Feature-detected AFTER mount only — server render and first client render
  // must agree (both false) or React throws a hydration mismatch. See
  // components/ConnectBar.tsx for the same mounted-guard pattern.
  const [serialAvailable, setSerialAvailable] = useState(false);
  useEffect(() => {
    setSerialAvailable(SerialTransport.available);
  }, []);

  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [rails, setRails] = useState<Record<string, RailState>>({});
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [logCounts, setLogCounts] = useState({ err: 0, warn: 0 });
  const [lastTlm, setLastTlm] = useState<TlmFrame>({});
  const [flightState, setFlightState] = useState("—");
  // Set when a REAL board link drops unexpectedly (device unplugged, USB
  // fault, …) — as opposed to the operator clicking Disconnect. Drives the
  // red/black "BOARD DISCONNECTED" warning box; cleared the moment a fresh
  // serial link comes up again.
  const [boardFault, setBoardFault] = useState<string | null>(null);

  const transportRef = useRef<Transport | null>(null);
  const pendingRef = useRef<Array<(line: string) => void>>([]);
  const seqRef = useRef(0);
  const t0Ref = useRef(performance.now() / 1000);
  const logIdRef = useRef(0);
  const profileRef = useRef<Profile | null>(null);
  /** Which transport kind is currently live, if any — read by the hotplug
   *  handlers below so they don't act on stale React-state closures. */
  const activeKindRef = useRef<TransportKind | null>(null);

  const graphBus = useMemo(() => new GraphBus(), []);

  const resolvePending = useCallback((line: string) => {
    const r = pendingRef.current.shift();
    if (r) r(line);
  }, []);

  const awaitReply = useCallback((timeoutMs = 2000): Promise<string> => {
    return new Promise((resolve) => {
      let done = false;
      const wrapped = (line: string) => {
        if (!done) {
          done = true;
          resolve(line);
        }
      };
      pendingRef.current.push(wrapped);
      setTimeout(() => {
        if (!done) {
          done = true;
          const idx = pendingRef.current.indexOf(wrapped);
          if (idx >= 0) pendingRef.current.splice(idx, 1);
          resolve("(no reply)");
        }
      }, timeoutMs);
    });
  }, []);

  // ── preflight-check resolution ─────────────────────────────────────────
  // Each checks[] entry now carries an authoritative `check` field: a TLM
  // boolean key that means PASS (board streams pg/baro_ok/accel_ok/sd_ok
  // etc. in every TLM line — see docs/fcd-protocol.md). PASS when
  // TLM[check]==1, FAIL when ==0. A check with NO `check` field (e.g.
  // "pyro continuity", which already has its own live CONT/OPEN badges in
  // the pyro panel) is purely informational and deliberately never
  // resolves — it stays on ChecksPanel's default "monitoring…" forever.
  const inferChecks = useCallback((vals: TlmFrame) => {
    const p = profileRef.current;
    if (!p) return;
    setChecks((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const c of p.checks) {
        const key = c.check;
        if (!key || !(key in vals)) continue;
        const v = vals[key];
        const status: CheckStatus = v ? "pass" : "fail";
        const detail = v ? "OK" : "FAIL";
        const cur = next[c.id];
        if (!cur || cur.status !== status || cur.detail !== detail) {
          next[c.id] = { status, detail };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, []);

  const onTelemetry = useCallback(
    (vals: TlmFrame) => {
      setLastTlm((prev) => ({ ...prev, ...vals }));
      const t = "t_ms" in vals ? Number(vals.t_ms) / 1000 : performance.now() / 1000 - t0Ref.current;
      const p = profileRef.current;
      if (p) {
        for (const g of p.graphs) {
          if (g.id in vals) graphBus.publish(g.id, t, Number(vals[g.id]));
        }
        if (p.rails.length) {
          setRails((prev) => {
            let changed = false;
            const next = { ...prev };
            for (const r of p.rails) {
              if (!(r.id in vals)) continue;
              const value = Number(vals[r.id]);
              const lo = r.min ?? 0;
              const hi = r.max ?? (value || 1);
              const span = Math.max(hi - lo, 0.01);
              let pct: number;
              let cls: RailState["cls"];
              if (value < RAIL_NO_BATT_V) {
                // Battery rail reading ~0V: no battery connected. Legitimate
                // (USB power doesn't back-feed the battery sense line), not
                // a parse failure or an alarm — render muted/grey, not red.
                pct = 0;
                cls = "off";
              } else {
                pct = Math.min(100, Math.max(0, ((value - lo) / span) * 100));
                const edgeBand = span * 0.08;
                cls = "ok";
                if (value < lo || value > hi) cls = "bad";
                else if (value < lo + edgeBand || value > hi - edgeBand) cls = "warn";
              }
              const cur = next[r.id];
              if (!cur || cur.value !== value || cur.pct !== pct || cur.cls !== cls) {
                next[r.id] = { value, pct, cls };
                changed = true;
              }
            }
            return changed ? next : prev;
          });
        }
      }
      inferChecks(vals);
      if ("state" in vals) setFlightState(String(vals.state));
    },
    [graphBus, inferChecks]
  );

  const buildFromDescriptor = useCallback((raw: Parameters<typeof normaliseProfile>[0], didFallBack: boolean) => {
    const p = normaliseProfile(raw);
    profileRef.current = p;
    setProfile(p);
    setFellBack(didFallBack);
    setChecks({});
    setRails({});
  }, []);

  const onLine = useCallback(
    (line: string) => {
      if (!line) return;
      if (line.startsWith("FCD1 ")) {
        const d = fcd.parseDescriptor(line);
        if (d) buildFromDescriptor(d, false);
        return;
      }
      const logEv = fcd.parseLog(line);
      if (logEv) {
        const t = fmtT(t0Ref.current);
        logIdRef.current += 1;
        const entry: LogLine = { id: logIdRef.current, level: logEv.level, msg: logEv.msg, t };
        setLogLines((prev) => {
          const next = [...prev, entry];
          return next.length > LOG_MAX ? next.slice(next.length - LOG_MAX) : next;
        });
        setLogCounts((prev) => ({
          err: prev.err + (logEv.level === "ERR" ? 1 : 0),
          warn: prev.warn + (logEv.level === "WARN" ? 1 : 0),
        }));
        resolvePending(line);
        return;
      }
      const tlm = fcd.parseTelemetry(line);
      if (tlm && (line.startsWith("TLM") || "state" in tlm || "agl_m" in tlm || "alt_m" in tlm)) {
        onTelemetry(tlm);
        return;
      }
      resolvePending(line);
    },
    [buildFromDescriptor, onTelemetry, resolvePending]
  );

  const onClose = useCallback((reason: string) => {
    const wasSerial = activeKindRef.current === "serial";
    activeKindRef.current = null;
    setConnected(false);
    setStatusState({ text: reason || "disconnected", cls: "down" });
    // An unexpected drop of a REAL board (device lost, USB fault, radio
    // dropout) is a flight-safety-relevant event worth the red/black "BOARD
    // DISCONNECTED" screen — a deliberate operator "Disconnect" click is
    // not. NO fallback to the simulator here (or anywhere else): the
    // disconnected screen is the resting state now; the sim only ever runs
    // if the operator explicitly picks it from the transport control.
    if (wasSerial && reason !== "disconnected by operator") {
      setBoardFault(reason || "board disconnected");
    }
  }, []);

  const handshake = useCallback(
    async (transport: Transport) => {
      transport.send("whoami");
      const descriptor = await new Promise<ReturnType<typeof fcd.parseDescriptor>>((resolve) => {
        let done = false;
        const handler = (line: string) => {
          const d = fcd.parseDescriptor(line);
          if (d && !done) {
            done = true;
            resolve(d);
          }
        };
        transport.onLine(handler);
        setTimeout(() => {
          if (!done) {
            done = true;
            resolve(null);
          }
        }, 1500);
      });
      buildFromDescriptor(descriptor || GENERIC_PROFILE, !descriptor);
    },
    [buildFromDescriptor]
  );

  /** Shared tail-end of every connect path (manual, auto-detect, hotplug):
   *  wire the line/close handlers, run `opener()` to actually establish the
   *  link, then the FCD handshake. `opener` is the only bit that differs
   *  between "open the native port picker" and "reopen an already-granted
   *  port with no prompt". */
  const attach = useCallback(
    async (transport: Transport, kind: TransportKind, opener: () => Promise<boolean>) => {
      // Exactly one transport is ever "live" at a time. Fully stop whatever
      // was previously attached (crucially: clearInterval() on a SimTransport
      // so its mock TLM can never keep ticking and interleave with a real
      // board's data once one attaches) BEFORE wiring up the new one. The
      // old transport's onClose is deliberately not fired here — this is an
      // internal handover, not a user-visible disconnect.
      const prev = transportRef.current;
      transportRef.current = null;
      if (prev && prev !== transport) {
        try {
          await prev.disconnect();
        } catch {
          /* noop */
        }
      }
      setIsSim(kind === "sim");
      transport.onLine(onLine);
      transport.onClose(onClose);
      await opener();
      transportRef.current = transport;
      activeKindRef.current = kind;
      setTransportLabel(transport.label);
      setStatusState({ text: `link up (${transport.label})`, cls: "up" });
      if (kind === "serial") setBoardFault(null);
      t0Ref.current = performance.now() / 1000;
      setLogLines([]);
      setLogCounts({ err: 0, warn: 0 });
      await handshake(transport);
      setConnected(true);
    },
    [handshake, onClose, onLine]
  );

  const connect = useCallback(
    async (kind: TransportKind, opts: ConnectOptions = {}) => {
      let transport: Transport;
      if (kind === "serial") {
        transport = new SerialTransport(opts.baud || 115200);
      } else if (kind === "ws") {
        if (!opts.wsUrl) throw new Error("enter a WebSocket URL, e.g. ws://192.168.4.1:81");
        transport = new WebSocketTransport(opts.wsUrl);
      } else {
        transport = new SimTransport();
      }
      setStatusState({
        text: kind === "serial" ? "connecting to OZONE…" : "connecting…",
        cls: "connecting",
      });
      try {
        await attach(transport, kind, () => transport.connect());
      } catch (e) {
        setStatusState({ text: `failed: ${(e as Error).message}`, cls: "down" });
        throw e;
      }
    },
    [attach]
  );

  /** Auto-detect flow: reopen a SerialPort the browser already granted this
   *  origin access to — no picker, no user gesture. Used both for the boot-
   *  time scan and for the 'connect' hotplug event. */
  const connectSerialPort = useCallback(
    async (port: SerialPort, baud = 115200) => {
      const transport = new SerialTransport(baud);
      await attach(transport, "serial", () => transport.connectPort(port));
    },
    [attach]
  );

  /** Tear down whatever transport is currently attached with NO status-text
   *  side effects — the caller decides what onClose()/boardFault reason (if
   *  any) applies. Cleared BEFORE the transport actually closes: cancelling
   *  a serial reader can resolve the pending read() and fire onClose()
   *  internally mid-way through transport.disconnect(); activeKindRef being
   *  null by then keeps that internal call from double-reporting. */
  const teardownTransport = useCallback(async () => {
    activeKindRef.current = null;
    const t = transportRef.current;
    transportRef.current = null;
    if (t) {
      try {
        await t.disconnect();
      } catch {
        /* noop */
      }
    }
  }, []);

  const disconnect = useCallback(async () => {
    await teardownTransport();
    setProfile(null);
    profileRef.current = null;
    setBoardFault(null);
    onClose("disconnected by operator");
  }, [onClose, teardownTransport]);

  // ── Boot-time auto-detect + hotplug (client only) ─────────────────────────
  // Runs once on mount. If Web Serial is available, silently reopens a
  // previously-authorized port (preferring one that matches OZONE's VID/PID)
  // with no picker/gesture required. If none is found (or opening it fails,
  // or Web Serial isn't supported at all), the console lands on the
  // DISCONNECTED state and stays there — no simulator fallback. The
  // simulator only ever runs if the operator explicitly picks it from the
  // transport control. Browsers block requestPort() without a user gesture,
  // so the very first-ever authorization is always the manual "Connect
  // board" click — this effect only ever uses getPorts()/hotplug events.
  useEffect(() => {
    let cancelled = false;

    async function bootDetect() {
      if (SerialTransport.available) {
        setStatusState({ text: "searching for OZONE…", cls: "connecting" });
        const ports = await SerialTransport.getAuthorizedPorts();
        const match = ports.find(SerialTransport.isOzonePort) || ports[0];
        if (match && !cancelled) {
          try {
            await connectSerialPort(match);
            return;
          } catch {
            /* granted port didn't open (unplugged, in use elsewhere, …) — land on disconnected below */
          }
        }
      }
      if (!cancelled) {
        setStatusState({ text: "no board connected", cls: "down" });
      }
    }

    bootDetect();

    const unsubscribe = SerialTransport.onHotplug(
      (port) => {
        // A granted OZONE-matching port just appeared — auto-connect unless
        // we're already on a live serial link.
        if (cancelled || activeKindRef.current === "serial") return;
        if (SerialTransport.isOzonePort(port)) {
          connectSerialPort(port).catch(() => {});
        }
      },
      () => {
        // Board unplugged: a genuine unexpected fault (not an operator
        // action), so it gets the red/black "BOARD DISCONNECTED" screen —
        // set explicitly here rather than inferred from onClose()'s reason
        // text — then tear down cleanly and STAY disconnected. No
        // simulator fallback.
        if (cancelled || activeKindRef.current !== "serial") return;
        setBoardFault("board disconnected (USB unplugged)");
        teardownTransport();
      }
    );

    return () => {
      cancelled = true;
      unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invoke = useCallback(
    async (actionId: string, args: Record<string, unknown> = {}): Promise<string> => {
      if (!transportRef.current) return "ERR not connected";
      const p = profileRef.current;
      const integrity = !!p?.caps.integrity && fcd.SAFETY_ACTIONS.has(actionId);
      const line = fcd.buildCommand("do", actionId, fcd.fmtArgs(args), {
        integrity,
        seq: integrity ? ++seqRef.current : undefined,
      });
      transportRef.current.send(line);
      return awaitReply();
    },
    [awaitReply]
  );

  /** "Identify": re-sends `whoami` (a quick link-alive / who-am-I-talking-to
   *  check that refreshes the board name/fw/protocol version shown in the
   *  UI if they've changed) AND fires `do identify` so the physical board
   *  blinks its LED + chirps its buzzer — one button, two effects. Works
   *  against the simulator too (it just logs + ACKs, see lib/sim.ts). */
  const identify = useCallback(async (): Promise<string> => {
    const transport = transportRef.current;
    if (!transport) return "ERR not connected";
    transport.send("whoami");
    const descriptor = await new Promise<ReturnType<typeof fcd.parseDescriptor>>((resolve) => {
      let done = false;
      const handler = (line: string) => {
        const d = fcd.parseDescriptor(line);
        if (d && !done) {
          done = true;
          resolve(d);
        }
      };
      transport.onLine(handler);
      setTimeout(() => {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, 1200);
    });
    if (descriptor) buildFromDescriptor(descriptor, false);
    const ack = await invoke("identify", {});
    const who = descriptor ? `${descriptor.name}${descriptor.fw ? ` · fw ${descriptor.fw}` : ""} · ${descriptor.p}` : "no whoami reply";
    return `${who} — ${ack}`;
  }, [buildFromDescriptor, invoke]);

  const setParam = useCallback(
    async (id: string, value: string): Promise<string> => {
      if (!transportRef.current) return "ERR not connected";
      const p = profileRef.current;
      const spec = p?.params.find((x) => x.id === id);
      const v = spec && spec.type === "bool" ? (value === "on" ? "1" : "0") : value;
      const line = fcd.buildCommand("set", id, v, {});
      transportRef.current.send(line);
      return awaitReply();
    },
    [awaitReply]
  );

  return {
    status,
    connected,
    profile,
    fellBack,
    transportLabel,
    isSim,
    serialAvailable,
    boardFault,
    checks,
    rails,
    logLines,
    logCounts,
    lastTlm,
    flightState,
    graphBus,
    connect,
    connectSerialPort,
    disconnect,
    invoke,
    identify,
    setParam,
  };
}

export type UseFcdConnection = ReturnType<typeof useFcdConnection>;
