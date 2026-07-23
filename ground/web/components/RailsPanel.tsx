import type { RailSpec } from "@/lib/types";
import type { RailState } from "@/hooks/useFcdConnection";

const FILL: Record<RailState["cls"], string> = {
  ok: "bg-green",
  warn: "bg-amber",
  bad: "bg-red",
  off: "bg-ink-faint",
};

export function RailsPanel({ rails, state }: { rails: RailSpec[]; state: Record<string, RailState> }) {
  return (
    <div className="glass rounded-[10px] p-3">
      <h2 className="mb-2.5 font-display text-[12px] tracking-wide text-ink-dim label-caps">Power rails</h2>
      {rails.length === 0 ? (
        <p className="text-[12px] text-ink-faint">Board declared no rails[].</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {rails.map((r) => {
            const s = state[r.id];
            const noBatt = s?.cls === "off";
            return (
              <div key={r.id} className={`frost px-2.5 py-2 ${noBatt ? "opacity-60" : ""}`}>
                <div className="mb-1 flex items-baseline justify-between">
                  <span className="label-caps text-[10px] text-ink-dim">{r.label}</span>
                  {noBatt ? (
                    <span className="tabular text-[11px] font-medium text-ink-faint">— no batt</span>
                  ) : (
                    <span className="tabular text-[13px] font-semibold text-ink">
                      {s ? s.value.toFixed(2) : "—"} <span className="text-[10px] font-normal text-ink-faint">V</span>
                    </span>
                  )}
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-black/30">
                  <div
                    className={`h-full rounded-full transition-[width] duration-300 ${s ? FILL[s.cls] : "bg-ink-faint"}`}
                    style={{ width: `${s && !noBatt ? s.pct : 0}%` }}
                  />
                </div>
                <div className="mt-0.5 text-[9px] text-ink-faint tabular">
                  {noBatt ? "battery not connected" : `${r.min ?? "?"}–${r.max ?? "?"} V`}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
