/**
 * events.ts — shared classification for structured `EVT` flight-milestone
 * events (see lib/fcd.ts#parseEvent), consumed by both the FLIGHT EVENTS
 * feed (components/EventsPanel.tsx) and the mission-control banner
 * (components/EventBanner.tsx), so the two never disagree about what colour
 * or label a given event gets.
 */
import type { EventSpec, Profile } from "./types";

export type EventClass = "accent" | "highlight" | "amber" | "danger" | "ok" | "info";

/**
 * Sane defaults per the standard EVT vocab (ARMED/DISARMED/LAUNCH/BURNOUT/
 * APOGEE/DEPLOY/PYRO/MAIN/LANDED/FAULT) — used whenever the descriptor
 * doesn't declare `events[]`, or declares it without a `class` for a given
 * name. Anything else entirely (an unknown name) falls back to "info".
 */
export const DEFAULT_EVENT_CLASS: Record<string, EventClass> = {
  ARMED: "amber",
  DISARMED: "info",
  LAUNCH: "accent",
  BURNOUT: "accent",
  APOGEE: "highlight",
  DEPLOY: "amber",
  PYRO: "amber",
  MAIN: "amber",
  LANDED: "ok",
  FAULT: "danger",
};

/** Events big enough to warrant the full-width mission-control banner. */
export const BANNER_EVENTS = new Set(["LAUNCH", "APOGEE", "DEPLOY", "PYRO", "LANDED"]);

/**
 * Resolve an event's visual class. PYRO is special-cased regardless of the
 * descriptor: a fire that didn't actually happen (`result` anything other
 * than "fired") or that failed to clear continuity (`cont_cleared=0`) is a
 * red warning, never the default amber "expected pyro event" colour — a
 * board should never be able to make a failed fire look routine just by
 * omitting `events[]`.
 */
export function resolveEventClass(profile: Profile | null | undefined, name: string, kv: Record<string, string>): EventClass {
  if (name === "PYRO") {
    const result = (kv.result || "").toLowerCase();
    const misfired = result !== "" && result !== "fired";
    const contNotCleared = kv.cont_cleared === "0";
    if (misfired || contNotCleared) return "danger";
  }
  const spec = profile?.events.find((e) => e.name === name);
  if (spec?.class) return spec.class;
  return DEFAULT_EVENT_CLASS[name] || "info";
}

export function resolveEventLabel(profile: Profile | null | undefined, name: string): string {
  const spec = profile?.events.find((e) => e.name === name);
  return spec?.label || name;
}

export function findEventSpec(profile: Profile | null | undefined, name: string): EventSpec | undefined {
  return profile?.events.find((e) => e.name === name);
}

/** Tailwind class fragments per EventClass — dot colour, text colour, ring/
 *  border colour — shared by the feed rows and the banner so they match. */
export const EVENT_CLASS_STYLE: Record<EventClass, { dot: string; text: string; border: string; bg: string }> = {
  accent: { dot: "bg-cyan", text: "text-cyan", border: "border-cyan-dim", bg: "bg-cyan/10" },
  highlight: { dot: "bg-ink", text: "text-ink", border: "border-ink-faint", bg: "bg-white/5" },
  amber: { dot: "bg-amber", text: "text-amber", border: "border-amber-dim", bg: "bg-amber/10" },
  danger: { dot: "bg-red", text: "text-red", border: "border-red-dim", bg: "bg-red/10" },
  ok: { dot: "bg-green", text: "text-green", border: "border-green/40", bg: "bg-green/10" },
  info: { dot: "bg-ink-faint", text: "text-ink-dim", border: "border-hairline-bright", bg: "bg-white/[0.03]" },
};

/** Compact "key value · key value" summary of an event's kv payload, for the
 *  feed row and banner subtitle. Skips `t_ms` (shown separately as the
 *  mission-clock timestamp). */
export function summarizeEventKv(kv: Record<string, string>): string {
  return Object.entries(kv)
    .filter(([k]) => k !== "t_ms")
    .map(([k, v]) => `${k} ${v}`)
    .join(" · ");
}

/** Mission-clock label from an event's kv `t_ms` if present, else null. */
export function eventMissionClock(kv: Record<string, string>): string | null {
  const raw = kv.t_ms;
  if (raw == null) return null;
  const ms = Number(raw);
  if (!Number.isFinite(ms)) return null;
  const s = ms / 1000;
  const mm = Math.floor(Math.abs(s) / 60);
  const ss = Math.abs(s) % 60;
  const sign = s < 0 ? "-" : "";
  return `T${sign}${mm}:${ss.toFixed(1).padStart(4, "0")}`;
}
