/**
 * chart.ts — dependency-free canvas scrolling line chart.
 *
 * Ported from firmware/tools/web-dashboard/js/chart.js. No charting library:
 * full control over the mission-control look, devicePixelRatio-aware,
 * gridlines, filled area under the line, min/max readout, auto-resize.
 * Owns its own repaint — callers `push(t, v)` and it draws immediately,
 * independent of React's render cycle (kept snappy at high telemetry rates).
 */

export interface ScrollChartOpts {
  unit?: string;
  accent?: string;
  maxPoints?: number;
}

interface Point {
  t: number;
  v: number;
}

export class ScrollChart {
  private ctx: CanvasRenderingContext2D;
  private unit: string;
  private accent: string;
  private maxPoints: number;
  private data: Point[] = [];
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement, opts: ScrollChartOpts = {}) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context unavailable");
    this.ctx = ctx;
    this.unit = opts.unit || "";
    this.accent = opts.accent || "#3fd7ff";
    this.maxPoints = opts.maxPoints || 240;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  setAccent(accent: string) {
    this.accent = accent;
    this.draw();
  }

  destroy() {
    this.ro.disconnect();
  }

  private resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width * dpr));
    const h = Math.max(1, Math.round(rect.height * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.draw();
  }

  push(t: number, v: number) {
    if (!Number.isFinite(v)) return;
    this.data.push({ t, v });
    if (this.data.length > this.maxPoints) this.data.shift();
    this.draw();
  }

  clear() {
    this.data = [];
    this.draw();
  }

  draw() {
    const { ctx, canvas } = this;
    const w = canvas.width,
      h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const dpr = window.devicePixelRatio || 1;
    if (this.data.length < 2) {
      ctx.fillStyle = "rgba(139,152,163,0.45)";
      ctx.font = `${12 * dpr}px var(--font-mono, ui-monospace, monospace)`;
      ctx.fillText("waiting for data…", 10 * dpr, h / 2);
      return;
    }
    const pad = 6 * dpr;
    const tMin = this.data[0].t,
      tMax = this.data[this.data.length - 1].t;
    let vMin = Math.min(...this.data.map((d) => d.v));
    let vMax = Math.max(...this.data.map((d) => d.v));
    if (vMin === vMax) {
      vMin -= 1;
      vMax += 1;
    }
    const vSpan = vMax - vMin;
    vMin -= vSpan * 0.08;
    vMax += vSpan * 0.08;
    const tSpan = Math.max(tMax - tMin, 1e-6);

    const X = (t: number) => pad + ((t - tMin) / tSpan) * (w - 2 * pad);
    const Y = (v: number) => h - pad - ((v - vMin) / (vMax - vMin)) * (h - 2 * pad);

    ctx.strokeStyle = "rgba(148,163,184,0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad + (i / 3) * (h - 2 * pad);
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(w - pad, y);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(X(this.data[0].t), Y(this.data[0].v));
    for (const d of this.data) ctx.lineTo(X(d.t), Y(d.v));
    ctx.lineTo(X(this.data[this.data.length - 1].t), h - pad);
    ctx.lineTo(X(this.data[0].t), h - pad);
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, this.accent + "33");
    grad.addColorStop(1, this.accent + "00");
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(X(this.data[0].t), Y(this.data[0].v));
    for (const d of this.data) ctx.lineTo(X(d.t), Y(d.v));
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1.8 * dpr;
    ctx.lineJoin = "round";
    ctx.stroke();

    const last = this.data[this.data.length - 1];
    ctx.beginPath();
    ctx.arc(X(last.t), Y(last.v), 3 * dpr, 0, Math.PI * 2);
    ctx.fillStyle = this.accent;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(X(last.t), Y(last.v), 6 * dpr, 0, Math.PI * 2);
    ctx.strokeStyle = this.accent + "55";
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();

    ctx.fillStyle = "rgba(231,237,241,0.55)";
    ctx.font = `${11 * dpr}px ui-monospace, monospace`;
    ctx.fillText(vMax.toFixed(1) + (this.unit ? " " + this.unit : ""), pad + 2, pad + 11 * dpr);
    ctx.fillText(vMin.toFixed(1) + (this.unit ? " " + this.unit : ""), pad + 2, h - pad - 3);
  }
}
