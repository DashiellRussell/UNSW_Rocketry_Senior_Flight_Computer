"use client";

/**
 * EventsPanel — "FLIGHT EVENTS": a chronological feed of structured `EVT`
 * flight-milestone lines (LAUNCH/BURNOUT/APOGEE/DEPLOY/PYRO/MAIN/LANDED/…),
 * distinct from the free-text LOG pane. Newest-first (top of the list) so
 * the latest milestone is always immediately visible with no scrolling —
 * unlike the log pane, which is high-volume and auto-scrolls to the bottom.
 */
import type { FlightEvent } from "@/hooks/useFcdConnection";
import type { Profile } from "@/lib/types";
import { EVENT_CLASS_STYLE, eventMissionClock, resolveEventClass, resolveEventLabel, summarizeEventKv } from "@/lib/events";

export function EventsPanel({ events, profile }: { events: FlightEvent[]; profile: Profile | null }) {
  const ordered = [...events].reverse();

  return (
    <div className="glass flex min-h-0 flex-col rounded-[10px] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-[12px] tracking-wide text-ink-dim label-caps">Flight events</h2>
        <span className="label-caps text-[10px] text-ink-faint">{events.length} logged</span>
      </div>
      <div className="frost flex h-[240px] flex-col gap-1 overflow-y-auto p-1.5">
        {ordered.length === 0 && <p className="p-2 text-[12px] text-ink-faint">No flight events yet.</p>}
        {ordered.map((e) => {
          const cls = resolveEventClass(profile, e.name, e.kv);
          const style = EVENT_CLASS_STYLE[cls];
          const label = resolveEventLabel(profile, e.name);
          const clock = eventMissionClock(e.kv) || e.t;
          const summary = summarizeEventKv(e.kv);
          return (
            <div key={e.id} className={`flex items-start gap-2 rounded-[6px] border px-2 py-1.5 ${style.border} ${style.bg}`}>
              <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${style.dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className={`text-[12px] font-bold tracking-wide label-caps ${style.text}`}>{label}</span>
                  <span className="tabular text-[10px] text-ink-faint">{clock}</span>
                </div>
                {summary && <p className="tabular truncate text-[10.5px] text-ink-dim">{summary}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
