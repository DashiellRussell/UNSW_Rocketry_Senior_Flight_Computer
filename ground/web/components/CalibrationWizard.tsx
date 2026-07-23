"use client";

/**
 * CalibrationWizard — 3-step guided orientation calibration for the BARE
 * BOARD (no rocket). Captures the live accel vector at three known poses,
 * solves the signed axis permutation (lib/orientation.ts#solveCalibration),
 * applies it immediately to the live OrientationView (via onApply ->
 * useImuCalibration), and presents a copy-pastable `imu` descriptor snippet
 * for firmware (fcd.c's DESC and the sim's SIM_FCD) — styled like the
 * /protocol page's copy-prompt blocks.
 */
import { useEffect, useRef, useState } from "react";
import type { ImuSpec, TlmFrame } from "@/lib/types";
import { solveCalibration, type CalibrationSamples, type Vec3 } from "@/lib/orientation";
import type { ImuCalibration } from "@/hooks/useImuCalibration";

const CAPTURE_MS = 1200;

const STEPS: { key: keyof CalibrationSamples; title: string; body: string }[] = [
  {
    key: "flat",
    title: "Step 1 — lay it FLAT",
    body: "Rest the bare board flat on a table, face up (the side with the header/etch you normally look at, facing the ceiling). Hold it still.",
  },
  {
    key: "longUp",
    title: "Step 2 — LONG edge up",
    body: "Stand the board on end so its LONG edge points straight up (like standing a domino on its longest side). Hold it still.",
  },
  {
    key: "shortUp",
    title: "Step 3 — SHORT edge up",
    body: "Stand the board on end the other way, so its SHORT edge points straight up. Hold it still.",
  },
];

function readAxis(tlm: TlmFrame, key: string): number {
  const v = tlm[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function CalibrationWizard({
  imu,
  lastTlm,
  onApply,
  onClose,
}: {
  imu: ImuSpec;
  lastTlm: TlmFrame;
  onApply: (cal: ImuCalibration) => void;
  onClose: () => void;
}) {
  const [stepIdx, setStepIdx] = useState(0); // 0..2 capture steps, 3 = result
  const [samples, setSamples] = useState<Partial<CalibrationSamples>>({});
  const [capturing, setCapturing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const bufRef = useRef<Vec3[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef = useRef<number | null>(null);

  const raw: Vec3 = [readAxis(lastTlm, imu.accel[0]), readAxis(lastTlm, imu.accel[1]), readAxis(lastTlm, imu.accel[2])];

  // Accumulate samples into the capture buffer every time fresh telemetry
  // arrives while a capture is in progress.
  useEffect(() => {
    if (!capturing) return;
    bufRef.current.push(raw);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, lastTlm]);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const result = samples.flat && samples.longUp && samples.shortUp ? solveCalibration(samples as CalibrationSamples) : null;

  const startCapture = () => {
    setError(null);
    bufRef.current = [];
    setCapturing(true);
    setProgress(0);
    const start = performance.now();
    const tick = () => {
      const pct = Math.min(100, ((performance.now() - start) / CAPTURE_MS) * 100);
      setProgress(pct);
      if (pct < 100) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    timerRef.current = setTimeout(() => {
      setCapturing(false);
      const buf = bufRef.current;
      if (buf.length < 3) {
        setError("Not enough telemetry samples arrived during the capture window — check the link is live and retry.");
        return;
      }
      const avg: Vec3 = [0, 0, 0];
      for (const s of buf) {
        avg[0] += s[0];
        avg[1] += s[1];
        avg[2] += s[2];
      }
      avg[0] /= buf.length;
      avg[1] /= buf.length;
      avg[2] /= buf.length;
      const key = STEPS[stepIdx].key;
      setSamples((prev) => ({ ...prev, [key]: avg }));
      setStepIdx((s) => Math.min(s + 1, 3));
    }, CAPTURE_MS);
  };

  const retryStep = (idx: number) => {
    setError(null);
    setStepIdx(idx);
    setSamples((prev) => {
      const next = { ...prev };
      delete next[STEPS[idx].key];
      return next;
    });
  };

  const snippet =
    result && !("error" in result)
      ? `"imu": ${JSON.stringify(
          { accel: imu.accel, map: result.map, up: result.up, units: imu.units || "g", g_rest: imu.g_rest ?? 1.0 },
          null,
          2
        )}`
      : "";

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1900);
    } catch {
      /* clipboard permission denied — the text is still selectable in the box */
    }
  };

  const solveError = result && "error" in result ? result.error : null;
  const solved = result && !("error" in result) ? result : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="glass rise-in w-[min(94vw,560px)] max-h-[88vh] overflow-y-auto rounded-[10px] p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-display text-[14px] tracking-wide text-ink">Orientation calibration</h3>
          <button onClick={onClose} className="pill px-2 py-0.5 text-[10px] label-caps hover:!text-ink">
            Close
          </button>
        </div>

        {/* step progress */}
        <div className="mb-3 flex gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`h-1 flex-1 rounded-full ${
                i < stepIdx || stepIdx === 3 ? "bg-cyan" : i === stepIdx ? "bg-amber" : "bg-hairline-bright"
              }`}
            />
          ))}
        </div>

        {stepIdx < 3 && (
          <div>
            <p className="label-caps text-[10px] text-cyan">{STEPS[stepIdx].title}</p>
            <p className="mt-1.5 text-[12px] leading-relaxed text-ink-dim">{STEPS[stepIdx].body}</p>

            <div className="frost mt-3 grid grid-cols-3 gap-1.5 p-2 text-center">
              {(["gx", "gy", "gz"] as const).map((label, i) => (
                <div key={label}>
                  <div className="label-caps text-[9px] text-ink-faint">{label}</div>
                  <div className="tabular text-[12px] text-ink">{raw[i].toFixed(2)}</div>
                </div>
              ))}
            </div>

            {error && <p className="mt-2 text-[11px] text-red">{error}</p>}

            <div className="mt-3 flex items-center gap-2">
              <button
                onClick={startCapture}
                disabled={capturing}
                className="btn-physical btn-physical-accent relative overflow-hidden rounded-[6px] px-3.5 py-2 text-[11px] font-bold tracking-wide label-caps disabled:opacity-70"
              >
                <span
                  className="absolute inset-y-0 left-0 bg-white/15"
                  style={{ width: `${capturing ? progress : 0}%`, transition: capturing ? "none" : "width 120ms" }}
                />
                <span className="relative">{capturing ? "Holding still…" : "Capture (1.2s)"}</span>
              </button>
              {stepIdx > 0 && !capturing && (
                <button onClick={() => retryStep(stepIdx - 1)} className="pill px-2.5 py-1 text-[11px] hover:!text-ink">
                  ← back
                </button>
              )}
            </div>
          </div>
        )}

        {stepIdx === 3 && (
          <div>
            {solveError ? (
              <div className="danger-box rounded-[6px] px-3 py-2.5 text-[12px] leading-relaxed">
                <p className="label-caps mb-1 text-[11px] font-bold">Calibration failed</p>
                <p className="opacity-90">{solveError}</p>
                <div className="mt-2.5 flex gap-1.5">
                  {STEPS.map((s, i) => (
                    <button
                      key={s.key}
                      onClick={() => retryStep(i)}
                      className="pill px-2.5 py-1 text-[10px] label-caps hover:!text-cyan"
                    >
                      redo {s.key}
                    </button>
                  ))}
                </div>
              </div>
            ) : solved ? (
              <div>
                <div className="frost mb-3 rounded-[6px] p-2.5 text-[12px]">
                  <p className="label-caps mb-1.5 text-[10px] text-green">✓ Solved</p>
                  <p className="text-ink-dim">
                    map <span className="tabular text-ink">{JSON.stringify(solved.map)}</span>, flight axis{" "}
                    <span className="tabular text-ink">{solved.up}</span> (long edge). Applied to the live view now.
                  </p>
                </div>

                <p className="label-caps mb-1.5 text-[10px] text-ink-faint">
                  Paste into fcd.c&apos;s DESC and the sim&apos;s SIM_FCD (lib/sim.ts):
                </p>
                <div className="mb-2 flex justify-end">
                  <button
                    onClick={copySnippet}
                    className={`rounded-full px-3 py-1 text-[11px] font-semibold tracking-wide transition ${
                      copied ? "bg-green text-[#062015]" : "bg-cyan text-[#031820] hover:brightness-110"
                    }`}
                  >
                    {copied ? "Copied!" : "Copy snippet"}
                  </button>
                </div>
                {/* Fixed-height, scroll-contained — a tall/wide imu snippet must
                    never expand the modal (or shove the OrientationView/
                    dashboard around behind it). Scrolls both axes inside its
                    own box instead of stretching. */}
                <pre className="frost max-h-[200px] overflow-auto p-2.5 text-[11px] leading-relaxed text-ink">
                  <code className="block w-max whitespace-pre font-mono">{snippet}</code>
                </pre>

                <div className="mt-3 flex justify-end gap-2">
                  <button onClick={() => retryStep(0)} className="pill px-3 py-1.5 text-[11px] hover:!text-ink">
                    Redo all
                  </button>
                  <button
                    onClick={() =>
                      onApply({ map: solved.map, up: solved.up, calibratedAt: new Date().toISOString() })
                    }
                    className="btn-physical btn-physical-accent rounded-[6px] px-3.5 py-1.5 text-[11px] font-bold label-caps"
                  >
                    Apply &amp; save
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
