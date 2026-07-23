/**
 * fcd.js — FCD/1 protocol: parsing + command framing.
 *
 * Pure functions, no DOM/transport dependencies, so they're unit-testable and
 * reusable from the simulator too. Mirrors firmware/tools/gcs/adapters.py
 * (parse_kv / parse_log / FCD1 regex) and PROTOCOL.md exactly.
 */

const FCD_RE = /FCD1\s+(\{.*\})\s*$/;
const KV_RE = /(\w+)=(\S+)/g;
const LOG_RE = /^\s*LOG\s+(ERR|WARN|INFO|DEBUG|E|W|I|D)\s+(.*)$/i;
const LVL_MAP = { E: "ERR", W: "WARN", I: "INFO", D: "DEBUG" };

/** Try to pull an FCD1 descriptor out of a raw line. Returns parsed JSON or null. */
export function parseDescriptor(line) {
  const m = FCD_RE.exec(line);
  if (!m) return null;
  try {
    return JSON.parse(m[1]);
  } catch (e) {
    return null;
  }
}

/** Coerce a raw string value the way the TUI does: 0/1 -> bool for armed & cont keys, else float, else string. */
function coerce(key, val) {
  if ((key.startsWith("armed") || key.startsWith("cont")) && (val === "0" || val === "1")) {
    return val === "1";
  }
  const f = Number(val);
  return Number.isFinite(f) && val.trim() !== "" ? f : val;
}

/** Parse a `TLM key=value ...` line (the TLM prefix is optional/tolerated) into a plain object, or null. */
export function parseTelemetry(line) {
  if (!line.includes("=")) return null;
  const out = {};
  let any = false;
  let match;
  KV_RE.lastIndex = 0;
  while ((match = KV_RE.exec(line)) !== null) {
    out[match[1]] = coerce(match[1], match[2]);
    any = true;
  }
  return any ? out : null;
}

/** Parse a `LOG <level> <message>` line -> {level, msg} or null. */
export function parseLog(line) {
  const m = LOG_RE.exec(line);
  if (!m) return null;
  const lvl = m[1].toUpperCase();
  return { level: LVL_MAP[lvl] || lvl, msg: m[2].trim() };
}

/** Parse a `PARAM id=value` reply. */
export function parseParamReply(line) {
  const m = /^PARAM\s+(\w+)=(\S+)/.exec(line.trim());
  if (!m) return null;
  return { id: m[1], value: coerce(m[1], m[2]) };
}

/** Parse an ACK/ERR reply line into {ok, action, rest, raw}. */
export function parseAck(line) {
  const s = line.trim();
  const m = /^(ACK|ERR)\s*(.*)$/.exec(s);
  if (!m) return null;
  const rest = m[2].trim();
  const [action, ...tail] = rest.split(/\s+/);
  return { ok: m[1] === "ACK", action: action || "", rest: tail.join(" "), raw: s };
}

/** Pull `token=NNNN` / `window=10s` / `key=NNNN` style fields out of an ACK's tail text. */
export function extractFields(text) {
  const out = {};
  let match;
  const re = /(\w+)=([^\s]+)/g;
  while ((match = re.exec(text)) !== null) {
    out[match[1]] = match[2];
  }
  return out;
}

/**
 * XOR-8 checksum over a string, hex-encoded 2 chars uppercase.
 * docs/telecom-command-protocol.md: "CRC (XOR/CRC8 of the line up to '*'), hex".
 * We implement the XOR-fold variant (cheap, matches an 8-bit MCU one-liner);
 * see README's "FCD ambiguities" note — the exact algorithm isn't pinned down
 * by the protocol doc, so this must match whatever pyro_trigger's firmware
 * counterpart implements once written.
 */
export function xor8(str) {
  let c = 0;
  for (let i = 0; i < str.length; i++) c ^= str.charCodeAt(i);
  return c.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * Build a `do <action> [k=v ...]` command line. If integrity is enabled,
 * appends ` seq=<n>` then `*<CRC>` computed over everything before the '*'.
 */
export function buildCommand(kind, action, args, opts) {
  opts = opts || {};
  let line = kind === "set"
    ? `set ${action} ${args}`
    : `do ${action}${args ? " " + args : ""}`;
  if (opts.integrity) {
    line += ` seq=${opts.seq}`;
    line += `*${xor8(line)}`;
  }
  return line;
}

/** Format an args object {k:v} into "k=v k2=v2" for `do`. */
export function fmtArgs(obj) {
  return Object.entries(obj || {})
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
}
