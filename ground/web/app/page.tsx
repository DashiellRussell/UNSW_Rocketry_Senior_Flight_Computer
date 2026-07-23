"use client";

import { useFcdConnectionContext } from "@/hooks/FcdConnectionProvider";
import { DisconnectedScreen } from "@/components/DisconnectedScreen";
import { Dashboard } from "@/components/Dashboard";

// ToastProvider now lives in app/layout.tsx (wrapping TopNav too, so its
// Identify control can toast) — this page just consumes useToast() via its
// children (ActionsPanel, PyroPanel, ParamsPanel).
export default function Home() {
  const fcd = useFcdConnectionContext();

  return !fcd.connected || !fcd.profile ? (
    <DisconnectedScreen detail={fcd.boardFault || fcd.status.text} />
  ) : (
    <Dashboard
      profile={fcd.profile}
      fellBack={fcd.fellBack}
      boardFault={fcd.boardFault}
      flightState={fcd.flightState}
      checks={fcd.checks}
      rails={fcd.rails}
      logLines={fcd.logLines}
      logCounts={fcd.logCounts}
      events={fcd.events}
      eventBanner={fcd.eventBanner}
      lastTlm={fcd.lastTlm}
      graphBus={fcd.graphBus}
      invoke={fcd.invoke}
      setParam={fcd.setParam}
    />
  );
}
