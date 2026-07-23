import type { Profile } from "@/lib/types";
import type { CheckState, EventBannerState, FlightEvent, LogLine, RailState } from "@/hooks/useFcdConnection";
import type { GraphBus } from "@/lib/bus";
import { BoardHeader } from "./BoardHeader";
import { ChecksPanel } from "./ChecksPanel";
import { RailsPanel } from "./RailsPanel";
import { GraphsPanel } from "./GraphsPanel";
import { LogPanel } from "./LogPanel";
import { EventsPanel } from "./EventsPanel";
import { EventBanner } from "./EventBanner";
import { ParamsPanel } from "./ParamsPanel";
import { ActionsPanel } from "./ActionsPanel";
import { PyroPanel } from "./PyroPanel";
import { OrientationView } from "./OrientationView";
import { accentColor } from "@/lib/accent";
import type { TlmFrame } from "@/lib/types";

export function Dashboard({
  profile,
  fellBack,
  boardFault,
  flightState,
  checks,
  rails,
  logLines,
  logCounts,
  events,
  eventBanner,
  lastTlm,
  graphBus,
  invoke,
  setParam,
}: {
  profile: Profile;
  fellBack: boolean;
  boardFault: string | null;
  flightState: string;
  checks: Record<string, CheckState>;
  rails: Record<string, RailState>;
  logLines: LogLine[];
  logCounts: { err: number; warn: number };
  events: FlightEvent[];
  eventBanner: EventBannerState | null;
  lastTlm: TlmFrame;
  graphBus: GraphBus;
  invoke: (id: string, args?: Record<string, unknown>) => Promise<string>;
  setParam: (id: string, value: string) => Promise<string>;
}) {
  const accent = accentColor(profile.accent);
  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-8 pt-4">
      {boardFault && (
        <div className="danger-box hazard-stripes mb-2.5 rounded-[6px] px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full bg-red pulse" />
            <span className="label-caps text-[12px] font-bold tracking-wider">Board disconnected</span>
            <span className="tabular text-[11px] opacity-80">{boardFault}</span>
          </div>
        </div>
      )}

      <EventBanner banner={eventBanner} profile={profile} />

      <BoardHeader profile={profile} flightState={flightState} fellBack={fellBack} />

      <div className={`grid grid-cols-1 gap-2.5 ${profile.imu ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        <ChecksPanel checks={profile.checks} state={checks} />
        <RailsPanel rails={profile.rails} state={rails} />
        {profile.imu && (
          <OrientationView imu={profile.imu} lastTlm={lastTlm} accent={profile.accent} boardName={profile.name} />
        )}
      </div>

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-[1.1fr_0.9fr_0.9fr]">
        <GraphsPanel graphs={profile.graphs} accent={accent} bus={graphBus} />
        <LogPanel lines={logLines} counts={logCounts} />
        <EventsPanel events={events} profile={profile} />
      </div>

      {profile.hasPyro && (
        <div className="mt-2.5">
          <PyroPanel
            profile={profile}
            lastTlm={lastTlm}
            api={{
              doAction: (id, args) => invoke(id, args),
              setParam: (id, value) => setParam(id, value),
            }}
          />
        </div>
      )}

      <div className="mt-2.5 grid grid-cols-1 gap-2.5 lg:grid-cols-2">
        <ParamsPanel params={profile.params} onSet={setParam} />
        <ActionsPanel actions={profile.actions} hasPyro={profile.hasPyro} onInvoke={(id, args) => invoke(id, args)} />
      </div>
    </main>
  );
}
