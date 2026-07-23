/**
 * transports.js — pluggable line-oriented links to a board.
 *
 * Every transport implements the same tiny interface so the rest of the app
 * (fcd.js parsing, ui.js rendering) never knows which one is in use:
 *
 *   async connect()            -> throws on failure
 *   send(line)                 -> write one line (newline appended)
 *   onLine(fn)                 -> fn(line) called for every received line
 *   onClose(fn)                -> fn(reason) called when the link drops
 *   async disconnect()
 *   label                      -> short string for the UI ("USB (COM5)", "ws://...")
 */

class LineBuffer {
  constructor(onLine) {
    this._buf = "";
    this._onLine = onLine;
  }
  push(chunk) {
    this._buf += chunk;
    let idx;
    while ((idx = this._buf.indexOf("\n")) >= 0) {
      const line = this._buf.slice(0, idx).replace(/\r$/, "");
      this._buf = this._buf.slice(idx + 1);
      if (this._onLine) this._onLine(line);
    }
  }
}

// ── Web Serial (USB-CDC / UART adapter) ─────────────────────────────────────
export class SerialTransport {
  constructor(baud) {
    this.baud = baud || 115200;
    this.label = "serial";
    this._lineHandlers = [];
    this._closeHandlers = [];
    this.port = null;
    this.writer = null;
  }

  static get available() {
    return "serial" in navigator;
  }

  onLine(fn) { this._lineHandlers.push(fn); }
  onClose(fn) { this._closeHandlers.push(fn); }

  async connect() {
    if (!SerialTransport.available) {
      throw new Error("Web Serial API not available (use Chrome/Edge, and http://localhost or https://)");
    }
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baud });
    const info = this.port.getInfo ? this.port.getInfo() : {};
    this.label = `USB ${info.usbVendorId ? `(${info.usbVendorId.toString(16)}:${(info.usbProductId||0).toString(16)})` : ""}`.trim();
    const decoder = new TextDecoderStream();
    this._readableClosed = this.port.readable.pipeTo(decoder.writable);
    this.reader = decoder.readable.getReader();
    this.writer = this.port.writable.getWriter();
    const buf = new LineBuffer((line) => this._lineHandlers.forEach((f) => f(line)));
    this._pump(buf);
    return true;
  }

  async _pump(buf) {
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) buf.push(value);
      }
    } catch (e) {
      // fallthrough to close
    }
    this._closeHandlers.forEach((f) => f("serial link closed"));
  }

  send(line) {
    if (!this.writer) return;
    const data = new TextEncoder().encode(line + "\n");
    this.writer.write(data).catch(() => {});
  }

  async disconnect() {
    try { if (this.reader) { await this.reader.cancel(); this.reader.releaseLock(); } } catch (e) {}
    try { if (this.writer) { this.writer.releaseLock(); } } catch (e) {}
    try { if (this._readableClosed) await this._readableClosed.catch(() => {}); } catch (e) {}
    try { if (this.port) await this.port.close(); } catch (e) {}
  }
}

// ── WebSocket (ESP32 telecom hub over WiFi) ─────────────────────────────────
export class WebSocketTransport {
  constructor(url) {
    this.url = url;
    this.label = url;
    this._lineHandlers = [];
    this._closeHandlers = [];
    this.ws = null;
  }

  onLine(fn) { this._lineHandlers.push(fn); }
  onClose(fn) { this._closeHandlers.push(fn); }

  connect() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const buf = new LineBuffer((line) => this._lineHandlers.forEach((f) => f(line)));
      ws.onopen = () => { settled = true; resolve(true); };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          // tolerate either whole-line messages or a raw text blob with '\n's
          buf.push(ev.data.endsWith("\n") ? ev.data : ev.data + "\n");
        }
      };
      ws.onerror = (ev) => {
        if (!settled) { settled = true; reject(new Error("WebSocket connection failed")); }
      };
      ws.onclose = () => { this._closeHandlers.forEach((f) => f("websocket closed")); };
    });
  }

  send(line) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(line + "\n");
  }

  async disconnect() {
    try { if (this.ws) this.ws.close(); } catch (e) {}
  }
}
