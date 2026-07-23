"use client";

/**
 * Backdrop — full-bleed canvas behind everything: large, EXTREMELY faint
 * radial-gradient blobs drifting on slow Lissajous paths. This is meant to
 * be almost subliminal — a defense-grade console (Palantir/Anduril register)
 * reads as quiet and near-monochrome, not a light show; the blobs exist only
 * so the hairline-bordered instrument panels have the faintest bit of life
 * behind them, not as a visual feature in their own right. Colours are read
 * from the live CSS custom properties, not hardcoded.
 *
 * No React state — the whole thing runs off one requestAnimationFrame loop,
 * same pattern as lib/chart.ts. Static (first frame only) under
 * prefers-reduced-motion. Mounted once in the root layout so / and
 * /protocol share the same drifting field.
 */
import { useEffect, useRef } from "react";

interface Blob {
  colorVar: "--color-cyan" | "--color-amber";
  s: number; // size, × min(w,h)
  bx: number; // home x, screen fraction
  by: number; // home y, screen fraction
  fx: number; // x drift frequency
  fy: number; // y drift frequency
  px: number; // x phase
  py: number; // y phase
  a: number; // peak alpha
}

// Alphas cut to roughly a third of the original recipe, per the near-
// monochrome/"quiet, not playful" direction — these should read as barely
// visible unless you're looking for them.
const BLOBS: Blob[] = [
  { colorVar: "--color-cyan", s: 1.15, bx: 0.22, by: 0.3, fx: 0.011, fy: 0.017, px: 0.0, py: 2.1, a: 0.055 },
  { colorVar: "--color-cyan", s: 0.9, bx: 0.78, by: 0.65, fx: 0.007, fy: 0.013, px: 3.4, py: 0.8, a: 0.04 },
  { colorVar: "--color-amber", s: 0.8, bx: 0.15, by: 0.8, fx: 0.009, fy: 0.006, px: 1.2, py: 4.0, a: 0.028 },
  { colorVar: "--color-cyan", s: 0.7, bx: 0.55, by: 0.15, fx: 0.014, fy: 0.008, px: 5.1, py: 3.0, a: 0.032 },
  { colorVar: "--color-amber", s: 0.6, bx: 0.85, by: 0.25, fx: 0.006, fy: 0.011, px: 2.6, py: 5.5, a: 0.02 },
];

function hexToRgb(hex: string): string {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return "63,215,255";
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export function Backdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const styles = getComputedStyle(document.documentElement);
    const bgColor = styles.getPropertyValue("--color-bg").trim() || "#08090b";
    const rgb: Record<Blob["colorVar"], string> = {
      "--color-cyan": hexToRgb(styles.getPropertyValue("--color-cyan") || "#3fd7ff"),
      "--color-amber": hexToRgb(styles.getPropertyValue("--color-amber") || "#ffb454"),
    };

    let w = 0;
    let h = 0;
    let dpr = 1;
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (tSec: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, w, h);

      for (const b of BLOBS) {
        const cx = w * (b.bx + 0.16 * Math.sin(b.fx * tSec * 2 * Math.PI + b.px));
        const cy = h * (b.by + 0.16 * Math.sin(b.fy * tSec * 2 * Math.PI + b.py));
        const R = Math.min(w, h) * b.s;
        const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        const c = rgb[b.colorVar];
        grad.addColorStop(0, `rgba(${c},${b.a})`);
        grad.addColorStop(0.55, `rgba(${c},${b.a * 0.35})`);
        grad.addColorStop(1, `rgba(${c},0)`);
        ctx.fillStyle = grad;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
      }
    };

    if (reduceMotion) {
      draw(0);
      return () => window.removeEventListener("resize", resize);
    }

    let raf = 0;
    const loop = (nowMs: number) => {
      draw((nowMs / 1000) * 0.35);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="fixed inset-0 -z-10 h-full w-full" />;
}
