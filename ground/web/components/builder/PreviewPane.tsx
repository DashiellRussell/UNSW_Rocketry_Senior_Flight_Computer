"use client";

/**
 * PreviewPane.tsx — zone 3: the WYSIWYG live preview. Renders the REAL
 * `Dashboard` component (components/Dashboard.tsx) — the exact same one
 * app/page.tsx shows for a connected board — fed by the builder's own
 * MockEngine (lib/builder/mockEngine.ts) instead of a Transport. Nothing
 * about the rendering path is reimplemented, so this can never drift from
 * what a real board with this descriptor would show.
 */
import type { Descriptor } from "@/lib/types";
import { normaliseProfile } from "@/lib/types";
import { Dashboard } from "@/components/Dashboard";
import { useMockEngine } from "@/lib/builder/useMockEngine";

export function PreviewPane({ descriptor }: { descriptor: Descriptor }) {
  const profile = normaliseProfile(descriptor);
  const { checks, rails, lastTlm, flightState, logLines, logCounts, graphBus, invoke, setParam } = useMockEngine(profile);

  return (
    <div className="glass flex flex-col gap-2 rounded-[10px] p-3">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-[12px] tracking-wide text-ink-dim label-caps">Live preview (mock telemetry)</h2>
        <span className="pill px-2 py-0.5 text-[9px] label-caps">simulated — no board attached</span>
      </div>
      <div
        className="overflow-x-auto rounded-[8px] [&_main]:mx-0 [&_main]:max-w-none [&_main]:px-0 [&_main]:pb-0 [&_main]:pt-0"
      >
        <div className="min-w-[360px]">
          <Dashboard
            profile={profile}
            fellBack={false}
            boardFault={null}
            flightState={flightState}
            checks={checks}
            rails={rails}
            logLines={logLines}
            logCounts={logCounts}
            lastTlm={lastTlm}
            graphBus={graphBus}
            invoke={invoke}
            setParam={setParam}
          />
        </div>
      </div>
    </div>
  );
}
