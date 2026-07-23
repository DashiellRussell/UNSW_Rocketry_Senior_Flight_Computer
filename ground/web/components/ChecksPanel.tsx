"use client";

/**
 * ChecksPanel — preflight checks, driven by a "RUN PREFLIGHT" sequencer so
 * it reads as a real, paced check rather than an instant table flip. Checks
 * are still computed live in the background the whole time (useFcdConnection
 * infers pass/warn/fail from telemetry continuously — see its README note
 * on checks[] having no dedicated wire representation); this component only
 * gates the REVEAL of that already-known state, one row at a time, with a
 * short "CHECKING…" beat per row (mirrors a real firmware console's
 * blue-reading -> green/red-resolved transition). Ends in a big GO / NO-GO
 * banner, NO-GO rendered in the red/black hazard style.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { CheckSpec } from "@/lib/types";
import type { CheckState } from "@/hooks/useFcdConnection";

const DOT: Record<CheckState["status"], string> = {
  pending: "bg-ink-faint",
  pass: "bg-green",
  warn: "bg-amber",
  fail: "bg-red",
};

const ROW_DELAY_MS = 520;

type Phase = "idle" | "running" | "done";

export function ChecksPanel({ checks, state }: { checks: CheckSpec[]; state: Record<string, CheckState> }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [revealed, setRevealed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  const runPreflight = useCallback(() => {
    clearTimer();
    setPhase("running");
    setRevealed(0);
    const step = (i: number) => {
      timerRef.current = setTimeout(() => {
        setRevealed(i + 1);
        if (i + 1 < checks.length) step(i + 1);
        else setPhase("done");
      }, ROW_DELAY_MS);
    };
    if (checks.length > 0) step(0);
    else setPhase("done");
  }, [checks.length, clearTimer]);

  useEffect(() => () => clearTimer(), [clearTimer]);

  // A live status flip DURING a completed run (e.g. continuity drops after
  // GO was called) should be visible immediately, not hidden behind a stale
  // "done" reveal — checks already revealed keep tracking `state` live.
  const rowStatus = (id: string, idx: number): { status: CheckState["status"] | "queued" | "checking"; detail: string } => {
    const live = state[id] || { status: "pending" as const, detail: "monitoring…" };
    if (phase === "idle") return { status: "queued", detail: "standby" };
    if (idx < revealed) return live;
    if (idx === revealed && phase === "running") return { status: "checking", detail: "reading…" };
    return { status: "queued", detail: "queued" };
  };

  const results = checks.map((c, idx) => rowStatus(c.id, idx));
  const allRevealed = phase === "done";
  const anyFail = results.some((r) => r.status === "fail");
  const anyWarn = results.some((r) => r.status === "warn");
  const goNoGo: "GO" | "NO-GO" | null = allRevealed ? (anyFail ? "NO-GO" : "GO") : null;

  return (
    <div className="glass rounded-[10px] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-[12px] tracking-wide text-ink-dim label-caps">Preflight checks</h2>
        {checks.length > 0 && (
          <button
            onClick={runPreflight}
            disabled={phase === "running"}
            className="btn-physical btn-physical-accent rounded-[6px] px-2.5 py-1 text-[10px] font-bold tracking-wider label-caps disabled:opacity-60"
          >
            {phase === "running" ? "Running…" : phase === "done" ? "Re-run preflight" : "Run preflight"}
          </button>
        )}
      </div>

      {checks.length === 0 ? (
        <p className="text-[12px] text-ink-faint">Board declared no checks[].</p>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {checks.map((c, idx) => {
              const r = results[idx];
              const isChecking = r.status === "checking";
              const isQueued = r.status === "queued";
              const dotCls = isChecking ? "bg-cyan" : isQueued ? "bg-ink-faint" : DOT[r.status as CheckState["status"]];
              return (
                <div
                  key={c.id}
                  className={`frost flex items-center gap-2.5 px-2.5 py-1.5 transition-opacity ${isQueued ? "opacity-50" : "opacity-100"}`}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotCls} ${isChecking || (isQueued && phase === "idle") ? "pulse" : ""}`}
                  />
                  <span className="flex-1 text-[12px] text-ink">{c.label}</span>
                  <span
                    className={`text-[10px] tabular label-caps ${
                      isChecking ? "text-cyan" : r.status === "fail" ? "text-red" : r.status === "warn" ? "text-amber" : "text-ink-faint"
                    }`}
                  >
                    {isChecking ? "checking…" : r.detail}
                  </span>
                </div>
              );
            })}
          </div>

          {goNoGo && (
            <div
              className={`mt-2.5 rounded-[6px] px-3 py-2 text-center text-[13px] font-bold tracking-[0.2em] label-caps ${
                goNoGo === "GO" ? "border border-green/45 bg-green/10 text-green" : "danger-box hazard-stripes"
              }`}
            >
              {goNoGo}
              {goNoGo === "NO-GO" && !anyFail && anyWarn ? " · WARNINGS PRESENT" : ""}
            </div>
          )}
        </>
      )}
    </div>
  );
}
