"use client";

/**
 * lib/builder/useMockEngine.ts — React glue around MockEngine, deriving
 * exactly the same {checks, rails, lastTlm, flightState, logLines, graphBus}
 * shape that hooks/useFcdConnection.ts derives from a real board, so the
 * SAME dashboard components (ChecksPanel/RailsPanel/GraphsPanel/
 * OrientationView/LogPanel) render identically in the builder's preview.
 *
 * The engine instance is created ONCE on mount and lives for the page's
 * lifetime — later profile edits are pushed in via `engine.updateProfile()`
 * rather than tearing the engine down, so the demo flight clock and graph
 * history stay continuous while the user tweaks fields.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Profile, TlmFrame, CheckStatus } from "@/lib/types";
import { GraphBus } from "@/lib/bus";
import { MockEngine } from "./mockEngine";

export interface CheckState {
  status: CheckStatus;
  detail: string;
}
export interface RailState {
  value: number;
  pct: number;
  cls: "ok" | "warn" | "bad" | "off";
}
export interface LogLine {
  id: number;
  level: "ERR" | "WARN" | "INFO" | "DEBUG";
  msg: string;
  t: string;
}

const RAIL_NO_BATT_V = 1.0;
const LOG_MAX = 200;

export function useMockEngine(profile: Profile) {
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [rails, setRails] = useState<Record<string, RailState>>({});
  const [lastTlm, setLastTlm] = useState<TlmFrame>({});
  const [flightState, setFlightState] = useState("—");
  const [logLines, setLogLines] = useState<LogLine[]>([]);
  const [logCounts, setLogCounts] = useState({ err: 0, warn: 0 });

  const graphBus = useMemo(() => new GraphBus(), []);
  const engineRef = useRef<MockEngine | null>(null);
  const profileRef = useRef(profile);
  profileRef.current = profile;
  const lastStateRef = useRef<string>("");
  const logIdRef = useRef(0);
  const t0Ref = useRef(performance.now() / 1000);

  useEffect(() => {
    const engine = new MockEngine(profileRef.current);
    engineRef.current = engine;

    const pushLog = (msg: string, level: LogLine["level"] = "INFO") => {
      const t = (performance.now() / 1000 - t0Ref.current).toFixed(1) + "s";
      logIdRef.current += 1;
      setLogLines((prev) => {
        const next = [...prev, { id: logIdRef.current, level, msg, t }];
        return next.length > LOG_MAX ? next.slice(next.length - LOG_MAX) : next;
      });
      if (level === "ERR" || level === "WARN") {
        setLogCounts((prev) => ({
          err: prev.err + (level === "ERR" ? 1 : 0),
          warn: prev.warn + (level === "WARN" ? 1 : 0),
        }));
      }
    };

    const EVENT_MSG: Record<string, string> = {
      BOOST: "liftoff confirmed — boosting",
      COAST: "motor burnout — coasting",
      APOGEE: "apogee detected",
      DESCENT: "drogue/main deploy sequence",
      LANDED: "landed — recovery beacon ON",
      PAD: "on pad, standing by",
    };

    const unsub = engine.subscribe((vals) => {
      setLastTlm((prev) => ({ ...prev, ...vals }));
      const p = profileRef.current;
      const t = "t_ms" in vals ? Number(vals.t_ms) / 1000 : performance.now() / 1000 - t0Ref.current;

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

      if (p.checks.length) {
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
      }

      if ("state" in vals) {
        const s = String(vals.state);
        setFlightState(s);
        if (s !== lastStateRef.current) {
          lastStateRef.current = s;
          if (EVENT_MSG[s]) pushLog(EVENT_MSG[s]);
        }
      }
    });

    engine.start();
    return () => {
      unsub();
      engine.stop();
    };
    // Mount-once: the engine is long-lived; see engine.updateProfile() below
    // for how later edits reach it without resetting the demo flight clock.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graphBus]);

  useEffect(() => {
    engineRef.current?.updateProfile(profile);
  }, [profile]);

  const invoke = useCallback((id: string, args?: Record<string, unknown>) => {
    return engineRef.current?.invoke(id, args) ?? Promise.resolve("ERR no engine");
  }, []);

  const setParam = useCallback((id: string, value: string) => {
    return engineRef.current?.setParam(id, value) ?? Promise.resolve("ERR no engine");
  }, []);

  return { checks, rails, lastTlm, flightState, logLines, logCounts, graphBus, invoke, setParam };
}
