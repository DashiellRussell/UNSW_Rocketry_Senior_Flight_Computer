/**
 * fcd.ts — FCD/1 protocol: parsing + command framing.
 *
 * Pure functions, no DOM/transport dependency — ported 1:1 from
 * firmware/tools/web-dashboard/js/fcd.js, typed, with the reconciled
 * session-mode command name (`do flight_mode [key=]`, not `session_key`)
 * and the safety-action list from the task brief:
 * arm / disarm / flight_mode / prime / deploy_ready / fire.
 *
 * See docs/fcd-protocol.md for the wire format this mirrors.
 */
import type { Descriptor, TlmFrame, TlmValue } from "./types";

const FCD_RE = /FCD1\s+(\{.*\})\s*$/;
const KV_RE = /(\w+)=(\S+)/g;
const LOG_RE = /^\s*LOG\s+(ERR|WARN|INFO|DEBUG|E|W|I|D)\s+(.*)$/i;
const LVL_MAP: Record<string, string> = { E: "ERR", W: "WARN", I: "INFO", D: "DEBUG" };

export type LogLevel = "ERR" | "WARN" | "INFO" | "DEBUG";

/** Try to pull an FCD1 descriptor out of a raw line. Returns parsed JSON or null. */
export function parseDescriptor(line: string): Descriptor | null {
  const m = FCD_RE.exec(line);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as Descriptor;
  } catch {
    return null;
  }
}

/** Coerce a raw string value: 0/1 -> bool for armed & cont* keys, else float, else string. */
function coerce(key: string, val: string): TlmValue {
  if ((key.startsWith("armed") || key.startsWith("cont")) && (val === "0" || val === "1")) {
    return val === "1";
  }
  const f = Number(val);
  return Number.isFinite(f) && val.trim() !== "" ? f : val;
}

/** Parse a `TLM key=value ...` line (the TLM prefix is optional/tolerated) into a plain object, or null. */
export function parseTelemetry(line: string): TlmFrame | null {
  if (!line.includes("=")) return null;
  const out: TlmFrame = {};
  let any = false;
  let match: RegExpExecArray | null;
  KV_RE.lastIndex = 0;
  while ((match = KV_RE.exec(line)) !== null) {
    out[match[1]] = coerce(match[1], match[2]);
    any = true;
  }
  return any ? out : null;
}

export interface LogEvent {
  level: LogLevel;
  msg: string;
}

/** Parse a `LOG <level> <message>` line -> {level, msg} or null. */
export function parseLog(line: string): LogEvent | null {
  const m = LOG_RE.exec(line);
  if (!m) return null;
  const lvl = m[1].toUpperCase();
  return { level: (LVL_MAP[lvl] || lvl) as LogLevel, msg: m[2].trim() };
}

export interface ParamReply {
  id: string;
  value: TlmValue;
}

/** Parse a `PARAM id=value` reply. */
export function parseParamReply(line: string): ParamReply | null {
  const m = /^PARAM\s+(\w+)=(\S+)/.exec(line.trim());
  if (!m) return null;
  return { id: m[1], value: coerce(m[1], m[2]) };
}

export interface AckReply {
  ok: boolean;
  action: string;
  rest: string;
  raw: string;
}

/** Parse an ACK/ERR reply line into {ok, action, rest, raw}. */
export function parseAck(line: string): AckReply | null {
  const s = line.trim();
  const m = /^(ACK|ERR)\s*(.*)$/.exec(s);
  if (!m) return null;
  const rest = m[2].trim();
  const [action, ...tail] = rest.split(/\s+/);
  return { ok: m[1] === "ACK", action: action || "", rest: tail.join(" "), raw: s };
}

/** Pull `token=NNNN` / `window=10s` / `key=NNNN` style fields out of an ACK's tail text. */
export function extractFields(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let match: RegExpExecArray | null;
  const re = /(\w+)=([^\s]+)/g;
  while ((match = re.exec(text)) !== null) {
    out[match[1]] = match[2];
  }
  return out;
}

/**
 * XOR-8 checksum over a string, hex-encoded 2 chars uppercase.
 * Matches fcd.c: XOR of the bytes before '*', printed as hex.
 */
export function xor8(str: string): string {
  let c = 0;
  for (let i = 0; i < str.length; i++) c ^= str.charCodeAt(i);
  return c.toString(16).toUpperCase().padStart(2, "0");
}

export interface BuildCommandOpts {
  integrity?: boolean;
  seq?: number;
}

/**
 * Build a `do <action> [k=v ...]` (or `set <id> <value>`) command line. If
 * integrity is enabled, appends ` seq=<n>` then `*<CRC>` computed over
 * everything before the '*'.
 */
export function buildCommand(
  kind: "do" | "set",
  action: string,
  args: string,
  opts: BuildCommandOpts = {}
): string {
  let line = kind === "set" ? `set ${action} ${args}` : `do ${action}${args ? " " + args : ""}`;
  if (opts.integrity) {
    line += ` seq=${opts.seq}`;
    line += `*${xor8(line)}`;
  }
  return line;
}

/** Format an args object {k:v} into "k=v k2=v2" for `do`. */
export function fmtArgs(obj: Record<string, unknown> | undefined | null): string {
  return Object.entries(obj || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}

/**
 * Safety-relevant actions that get CRC+seq integrity framing when the
 * descriptor's caps.integrity is truthy. Reconciled per task brief:
 * arm / disarm / flight_mode / prime / deploy_ready / fire.
 * (`safe` is NOT integrity-framed — it only clears state, nothing fires.)
 */
export const SAFETY_ACTIONS = new Set([
  "arm",
  "disarm",
  "flight_mode",
  "prime",
  "deploy_ready",
  "fire",
]);
