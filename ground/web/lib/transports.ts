/**
 * transports.ts — pluggable line-oriented links to a board.
 *
 * Every transport implements the same tiny interface so the rest of the app
 * (fcd.ts parsing, React components) never knows which one is in use. Ported
 * 1:1 from firmware/tools/web-dashboard/js/transports.js.
 */

export interface Transport {
  label: string;
  connect(): Promise<boolean>;
  send(line: string): void;
  onLine(fn: (line: string) => void): void;
  onClose(fn: (reason: string) => void): void;
  disconnect(): Promise<void>;
}

class LineBuffer {
  private buf = "";
  constructor(private onLine: (line: string) => void) {}
  push(chunk: string) {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, idx).replace(/\r$/, "");
      this.buf = this.buf.slice(idx + 1);
      this.onLine(line);
    }
  }
}

/**
 * OZONE's USB-CDC identity: an STM32 in "Virtual ComPort" mode enumerates as
 * VID 0x0483 (STMicroelectronics) / PID 0x5740 (Virtual COM Port). Used both
 * to pre-filter the manual `requestPort()` picker and to recognise the board
 * among already-authorized ports for silent auto-connect.
 */
export const OZONE_USB_FILTERS: SerialPortFilter[] = [{ usbVendorId: 0x0483, usbProductId: 0x5740 }];

function getSerial(): Serial | null {
  if (typeof navigator === "undefined" || !("serial" in navigator)) return null;
  return (navigator as Navigator & { serial: Serial }).serial;
}

// ── Web Serial (USB-CDC / UART adapter) ─────────────────────────────────────
export class SerialTransport implements Transport {
  label = "serial";
  private lineHandlers: ((line: string) => void)[] = [];
  private closeHandlers: ((reason: string) => void)[] = [];
  private port: SerialPort | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private reader: ReadableStreamDefaultReader<string> | null = null;
  private readableClosed: Promise<void> | null = null;

  constructor(private baud = 115200) {}

  static get available(): boolean {
    return getSerial() !== null;
  }

  /** Ports the user has already granted this origin access to (no prompt). */
  static async getAuthorizedPorts(): Promise<SerialPort[]> {
    const serial = getSerial();
    if (!serial) return [];
    try {
      return await serial.getPorts();
    } catch {
      return [];
    }
  }

  static isOzonePort(port: SerialPort): boolean {
    const info = port.getInfo ? port.getInfo() : {};
    return info.usbVendorId === 0x0483 && info.usbProductId === 0x5740;
  }

  /** Subscribe to the browser's serial hotplug events. No-ops (returns a
   *  no-op unsubscribe) if Web Serial isn't available — safe to call
   *  unconditionally from an effect. */
  static onHotplug(onConnect: (port: SerialPort) => void, onDisconnect: (port: SerialPort) => void): () => void {
    const serial = getSerial();
    if (!serial) return () => {};
    const connectHandler = (ev: Event) => onConnect((ev as Event & { target: SerialPort }).target);
    const disconnectHandler = (ev: Event) => onDisconnect((ev as Event & { target: SerialPort }).target);
    serial.addEventListener("connect", connectHandler);
    serial.addEventListener("disconnect", disconnectHandler);
    return () => {
      serial.removeEventListener("connect", connectHandler);
      serial.removeEventListener("disconnect", disconnectHandler);
    };
  }

  onLine(fn: (line: string) => void) {
    this.lineHandlers.push(fn);
  }
  onClose(fn: (reason: string) => void) {
    this.closeHandlers.push(fn);
  }

  /** Manual connect flow: opens the browser's native port picker, pre-
   *  filtered to OZONE's VID/PID. Requires a user gesture (click handler). */
  async connect(): Promise<boolean> {
    const serial = getSerial();
    if (!serial) {
      throw new Error("Web Serial API not available (use Chrome/Edge, and http://localhost or https://)");
    }
    const port = await serial.requestPort({ filters: OZONE_USB_FILTERS });
    return this.connectPort(port);
  }

  /** Auto-connect flow: opens a SerialPort the browser already granted
   *  access to (from getAuthorizedPorts() or a 'connect' hotplug event) —
   *  no picker, no user gesture needed. */
  async connectPort(port: SerialPort): Promise<boolean> {
    this.port = port;
    await this.port.open({ baudRate: this.baud });
    const info = this.port.getInfo ? this.port.getInfo() : {};
    this.label = `USB ${
      info.usbVendorId ? `(${info.usbVendorId.toString(16)}:${(info.usbProductId || 0).toString(16)})` : ""
    }`.trim();
    const decoder = new TextDecoderStream();
    if (!this.port.readable || !this.port.writable) throw new Error("port has no readable/writable stream");
    this.readableClosed = this.port.readable.pipeTo(decoder.writable as unknown as WritableStream<Uint8Array>);
    // pipeTo()'s promise rejects the instant the underlying USB device is
    // unplugged mid-stream (NetworkError: "The device has been lost."). If
    // nothing observes that rejection immediately it surfaces to the
    // browser/Next as an UNHANDLED promise rejection — a hard crash overlay
    // for what is really just a cable coming loose. Attach a no-op catch
    // right here (in addition to the awaited one in disconnect()) so a
    // mid-stream device loss is always treated as an ordinary disconnect.
    this.readableClosed.catch(() => {});
    this.reader = decoder.readable.getReader();
    this.writer = this.port.writable.getWriter();
    const buf = new LineBuffer((line) => this.lineHandlers.forEach((f) => f(line)));
    this.pump(buf);
    return true;
  }

  private async pump(buf: LineBuffer) {
    let reason = "serial link closed";
    try {
      for (;;) {
        if (!this.reader) break; // port was closed out from under us (disconnect() ran first)
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value) buf.push(value);
      }
    } catch (e) {
      // Covers the device-unplugged-mid-stream case: reader.read() rejects
      // with a DOMException/NetworkError ("The device has been lost.") —
      // this is a NORMAL disconnect for a USB link, not an app bug, so it's
      // swallowed here and reported through the ordinary onClose() path
      // rather than thrown/rethrown.
      const msg = e instanceof Error ? e.message : String(e);
      reason = /lost|disconnect|network/i.test(msg) ? "board disconnected (device lost)" : "serial link closed";
    }
    this.reader = null;
    this.writer = null;
    this.closeHandlers.forEach((f) => f(reason));
  }

  send(line: string) {
    if (!this.writer) return;
    const data = new TextEncoder().encode(line + "\n");
    // A write can also reject with "device has been lost" if the cable came
    // out between the last successful read and this write — swallow it the
    // same way; the read loop's own catch will report the disconnect.
    this.writer.write(data).catch(() => {});
  }

  async disconnect() {
    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
      }
    } catch {
      /* noop — reader may already be gone if the device was unplugged */
    } finally {
      this.reader = null;
    }
    try {
      if (this.writer) this.writer.releaseLock();
    } catch {
      /* noop */
    } finally {
      this.writer = null;
    }
    try {
      if (this.readableClosed) await this.readableClosed.catch(() => {});
    } catch {
      /* noop */
    }
    try {
      if (this.port) await this.port.close();
    } catch {
      /* noop — port may already be closed if the OS/driver dropped it */
    }
  }
}

// ── WebSocket (ESP32 telecom hub over WiFi) ─────────────────────────────────
export class WebSocketTransport implements Transport {
  label: string;
  private lineHandlers: ((line: string) => void)[] = [];
  private closeHandlers: ((reason: string) => void)[] = [];
  private ws: WebSocket | null = null;

  constructor(private url: string) {
    this.label = url;
  }

  onLine(fn: (line: string) => void) {
    this.lineHandlers.push(fn);
  }
  onClose(fn: (reason: string) => void) {
    this.closeHandlers.push(fn);
  }

  connect(): Promise<boolean> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(this.url);
      this.ws = ws;
      const buf = new LineBuffer((line) => this.lineHandlers.forEach((f) => f(line)));
      ws.onopen = () => {
        settled = true;
        resolve(true);
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === "string") {
          buf.push(ev.data.endsWith("\n") ? ev.data : ev.data + "\n");
        }
      };
      ws.onerror = () => {
        if (!settled) {
          settled = true;
          reject(new Error("WebSocket connection failed"));
        }
      };
      ws.onclose = () => this.closeHandlers.forEach((f) => f("websocket closed"));
    });
  }

  send(line: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(line + "\n");
  }

  async disconnect() {
    try {
      if (this.ws) this.ws.close();
    } catch {
      /* noop */
    }
  }
}
