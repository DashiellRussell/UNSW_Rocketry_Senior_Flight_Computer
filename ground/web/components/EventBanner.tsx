"use client";

/**
 * EventBanner — the mission-control "big moment" flash: a full-width strip
 * for LAUNCH/APOGEE/DEPLOY/PYRO/LANDED (see lib/events.ts#BANNER_EVENTS),
 * e.g. "APOGEE — agl 920.4 · vel -1.2". Appears, holds, and fades via one
 * CSS animation (`.event-banner-anim` in app/globals.css, timed to match
 * BANNER_MS in useFcdConnection.ts exactly) — no separate fade-out timer to
 * keep in sync. One at a time; a new bannerable event replaces it (keyed by
 * id so the animation restarts even for a repeat of the same name).
 *
 * A misfired/failed PYRO or a FAULT still routes through here (both are in
 * BANNER_EVENTS/resolve to the "danger" class) but gets the danger-box
 * treatment instead of the normal tinted strip, so a real problem doesn't
 * get lost in the same quiet styling as a routine milestone.
 */
import type { EventBannerState } from "@/hooks/useFcdConnection";
import type { Profile } from "@/lib/types";
import { EVENT_CLASS_STYLE, resolveEventClass, resolveEventLabel, summarizeEventKv } from "@/lib/events";

export function EventBanner({ banner, profile }: { banner: EventBannerState | null; profile: Profile | null }) {
  if (!banner) return null;
  const cls = resolveEventClass(profile, banner.name, banner.kv);
  const style = EVENT_CLASS_STYLE[cls];
  const label = resolveEventLabel(profile, banner.name);
  const summary = summarizeEventKv(banner.kv);
  const critical = cls === "danger";

  return (
    <div
      key={banner.id}
      className={`event-banner-anim mb-2.5 flex items-center gap-3 rounded-[8px] border px-4 py-2.5 ${
        critical ? "danger-box hazard-stripes" : `${style.border} ${style.bg}`
      }`}
    >
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full pulse ${critical ? "bg-red" : style.dot}`} />
      <span className={`font-display text-[16px] font-bold tracking-wide label-caps ${critical ? "" : style.text}`}>
        {label}
      </span>
      {summary && <span className={`tabular text-[12px] ${critical ? "opacity-85" : "text-ink-dim"}`}>— {summary}</span>}
    </div>
  );
}
