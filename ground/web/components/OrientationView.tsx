"use client";

/**
 * OrientationView — "ORIENTATION (accel-derived)". Renders a small hand-
 * rolled 3D projection of the bare board, posed by the live accelerometer
 * vector (per the descriptor's `imu` field, re-expressed in the board's own
 * x/y/z frame via the calibrated axis map), plus a fixed reference axis
 * triad and a gx/gy/gz + tilt-angle numeric readout.
 *
 * Tilt-from-gravity only — no yaw, and in powered flight the vector tracks
 * thrust, not gravity (both called out in the on-panel caption). Hidden
 * entirely if the descriptor doesn't declare `imu` (see Dashboard.tsx).
 *
 * "Calibrate orientation" opens a 3-step wizard (CalibrationWizard.tsx) that
 * solves the signed axis permutation for THIS physical board and applies it
 * immediately here; the result persists in localStorage (useImuCalibration).
 */
import { useEffect, useRef, useState } from "react";
import type { ImuSpec, TlmFrame } from "@/lib/types";
import { applyAxisMap, orientModel, project, tiltAngleDeg, BOARD_MODEL, type Vec3 } from "@/lib/orientation";
import { accentColor } from "@/lib/accent";
import { useImuCalibration } from "@/hooks/useImuCalibration";
import { CalibrationWizard } from "./CalibrationWizard";

function readAxis(tlm: TlmFrame, key: string): number {
  const v = tlm[key];
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

const AXIS_LABEL: Record<string, string> = { x: "short", y: "long", z: "normal" };

export function OrientationView({
  imu,
  lastTlm,
  accent = "cyan",
  boardName,
}: {
  imu: ImuSpec;
  lastTlm: TlmFrame;
  accent?: string;
  boardName: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const { calibration, effectiveImu, save, clear } = useImuCalibration(imu, boardName);

  const gx = readAxis(lastTlm, imu.accel[0]);
  const gy = readAxis(lastTlm, imu.accel[1]);
  const gz = readAxis(lastTlm, imu.accel[2]);
  const hasData = imu.accel.some((k) => k in lastTlm);
  const raw: Vec3 = [gx, gy, gz];
  const boardFrame = applyAxisMap(raw, effectiveImu.map);
  const tilt = hasData ? tiltAngleDeg(boardFrame) : 0;
  const accentHex = accentColor(accent);
  const flightAxisLetter = effectiveImu.up.replace(/[+-]/, "").toLowerCase();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2 + 4 * dpr;
    const scale = Math.min(w, h) * 0.42;

    const inkFaint = "rgba(134,140,149,0.5)";
    const inkDim = "rgba(228,231,235,0.75)";

    // ── fixed reference axis triad (camera-projected only, no accel rotation) ──
    // The board's own x/y/z axes, drawn from its rest pose — the flight axis
    // (from `up`, informational only) is highlighted in the accent colour so
    // it's clear which edge corresponds to the rocket's thrust axis.
    const axes: { v: Vec3; label: string; letter: string }[] = [
      { v: [1, 0, 0], label: `X·${AXIS_LABEL.x}`, letter: "x" },
      { v: [0, 1, 0], label: `Y·${AXIS_LABEL.y}`, letter: "y" },
      { v: [0, 0, 1], label: `Z·${AXIS_LABEL.z}`, letter: "z" },
    ];
    ctx.font = `${9.5 * dpr}px var(--font-mono, monospace)`;
    for (const ax of axes) {
      const isFlightAxis = ax.letter === flightAxisLetter;
      const color = isFlightAxis ? accentHex : inkFaint;
      const [ex, ey] = project([ax.v[0] * 0.95, ax.v[1] * 0.95, ax.v[2] * 0.95], scale, cx, cy);
      ctx.strokeStyle = color;
      ctx.lineWidth = (isFlightAxis ? 1.6 : 1) * dpr;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.fillText(ax.label, ex + 3 * dpr, ey + 3 * dpr);
    }

    // ── board body, oriented by the measured (axis-mapped) accel vector ──
    const rotate = (p: Vec3) => orientModel([p], boardFrame)[0];
    const proj = (p: Vec3) => project(rotate(p), scale, cx, cy);

    const corners = BOARD_MODEL.corners.map(proj);
    ctx.strokeStyle = accentHex;
    ctx.lineWidth = 1.4 * dpr;
    for (const [a, b] of BOARD_MODEL.edges) {
      ctx.beginPath();
      ctx.moveTo(corners[a][0], corners[a][1]);
      ctx.lineTo(corners[b][0], corners[b][1]);
      ctx.stroke();
    }

    // "front" notch tick on the far long edge, top face
    const na = proj(BOARD_MODEL.notch.a);
    const nb = proj(BOARD_MODEL.notch.b);
    const nt = proj(BOARD_MODEL.notch.tip);
    ctx.strokeStyle = inkDim;
    ctx.lineWidth = 1.2 * dpr;
    ctx.beginPath();
    ctx.moveTo(na[0], na[1]);
    ctx.lineTo(nt[0], nt[1]);
    ctx.lineTo(nb[0], nb[1]);
    ctx.stroke();

    // reference marker dot (fixed corner, so rotation reads legibly)
    const marker = proj(BOARD_MODEL.marker);
    ctx.beginPath();
    ctx.arc(marker[0], marker[1], 2.4 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = accentHex;
    ctx.fill();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accentHex, gx, gy, gz, effectiveImu, flightAxisLetter]);

  return (
    <div className="glass rounded-[10px] p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <h2 className="font-display text-[12px] tracking-wide text-ink-dim label-caps">Orientation (accel-derived)</h2>
        <div className="flex items-center gap-1.5">
          <span className="tabular text-[11px] text-ink-faint">tilt {tilt.toFixed(1)}°</span>
          <button
            onClick={() => setWizardOpen(true)}
            className="pill px-2 py-0.5 text-[9px] font-semibold label-caps hover:!text-cyan"
          >
            Calibrate
          </button>
        </div>
      </div>
      <div className="frost h-[150px] w-full overflow-hidden">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5 text-center">
        <div className="frost px-1.5 py-1">
          <div className="label-caps text-[9px] text-ink-faint">gx</div>
          <div className="tabular text-[12px] text-ink">{gx.toFixed(2)}</div>
        </div>
        <div className="frost px-1.5 py-1">
          <div className="label-caps text-[9px] text-ink-faint">gy</div>
          <div className="tabular text-[12px] text-ink">{gy.toFixed(2)}</div>
        </div>
        <div className="frost px-1.5 py-1">
          <div className="label-caps text-[9px] text-ink-faint">gz</div>
          <div className="tabular text-[12px] text-ink">{gz.toFixed(2)}</div>
        </div>
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-ink-faint">
        Tilt-from-gravity only (no yaw). In powered flight this vector tracks thrust, not gravity.
        {calibration ? (
          <>
            {" "}
            · calibrated{" "}
            <button onClick={clear} className="underline decoration-dotted hover:text-red">
              (clear)
            </button>
          </>
        ) : (
          " · uncalibrated axis mapping (identity) — run Calibrate for a real board."
        )}
      </p>

      {wizardOpen && (
        <CalibrationWizard
          imu={imu}
          lastTlm={lastTlm}
          onApply={(cal) => {
            save(cal);
            setWizardOpen(false);
          }}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}
