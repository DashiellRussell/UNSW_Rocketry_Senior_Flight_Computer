/**
 * chart.js — tiny dependency-free canvas scrolling line chart.
 *
 * No vendored charting library: a hand-rolled canvas renderer is ~100 lines
 * and gives full control over the mission-control look, so that's what this
 * uses instead of pulling in Chart.js/D3/etc. Handles devicePixelRatio,
 * gridlines, a filled area under the line, min/max readout, and resizing.
 */
export class ScrollChart {
  constructor(canvas, { unit = "", accent = "#3fd0ff", maxPoints = 240 } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.unit = unit;
    this.accent = accent;
    this.maxPoints = maxPoints;
    this.data = []; // [{t, v}]
    this._ro = new ResizeObserver(() => this._resize());
    this._ro.observe(canvas);
    this._resize();
  }

  _resize() {
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

  push(t, v) {
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
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    if (this.data.length < 2) {
      ctx.fillStyle = "rgba(148,163,184,0.35)";
      ctx.font = `${12 * (window.devicePixelRatio||1)}px ui-monospace, monospace`;
      ctx.fillText("waiting for data…", 10, h / 2);
      return;
    }
    const pad = 6 * (window.devicePixelRatio || 1);
    const tMin = this.data[0].t, tMax = this.data[this.data.length - 1].t;
    let vMin = Math.min(...this.data.map((d) => d.v));
    let vMax = Math.max(...this.data.map((d) => d.v));
    if (vMin === vMax) { vMin -= 1; vMax += 1; }
    const vSpan = vMax - vMin;
    vMin -= vSpan * 0.08; vMax += vSpan * 0.08;
    const tSpan = Math.max(tMax - tMin, 1e-6);

    const X = (t) => pad + ((t - tMin) / tSpan) * (w - 2 * pad);
    const Y = (v) => h - pad - ((v - vMin) / (vMax - vMin)) * (h - 2 * pad);

    // gridlines
    ctx.strokeStyle = "rgba(148,163,184,0.12)";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) {
      const y = pad + (i / 3) * (h - 2 * pad);
      ctx.beginPath(); ctx.moveTo(pad, y); ctx.lineTo(w - pad, y); ctx.stroke();
    }

    // filled area
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

    // line
    ctx.beginPath();
    ctx.moveTo(X(this.data[0].t), Y(this.data[0].v));
    for (const d of this.data) ctx.lineTo(X(d.t), Y(d.v));
    ctx.strokeStyle = this.accent;
    ctx.lineWidth = 1.8 * (window.devicePixelRatio || 1);
    ctx.lineJoin = "round";
    ctx.stroke();

    // last-point dot
    const last = this.data[this.data.length - 1];
    ctx.beginPath();
    ctx.arc(X(last.t), Y(last.v), 3 * (window.devicePixelRatio || 1), 0, Math.PI * 2);
    ctx.fillStyle = this.accent;
    ctx.fill();

    // min/max labels
    ctx.fillStyle = "rgba(226,232,240,0.55)";
    ctx.font = `${11 * (window.devicePixelRatio||1)}px ui-monospace, monospace`;
    ctx.fillText(vMax.toFixed(1) + (this.unit ? " " + this.unit : ""), pad + 2, pad + 11 * (window.devicePixelRatio||1));
    ctx.fillText(vMin.toFixed(1) + (this.unit ? " " + this.unit : ""), pad + 2, h - pad - 3);
  }
}
