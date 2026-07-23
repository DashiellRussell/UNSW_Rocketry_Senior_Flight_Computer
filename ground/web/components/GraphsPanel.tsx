import type { GraphSpec } from "@/lib/types";
import type { GraphBus } from "@/lib/bus";
import { GraphCard } from "./GraphCard";

export function GraphsPanel({ graphs, accent, bus }: { graphs: GraphSpec[]; accent: string; bus: GraphBus }) {
  return (
    <div className="glass rounded-[10px] p-3">
      <h2 className="mb-2.5 font-display text-[12px] tracking-wide text-ink-dim label-caps">Live telemetry</h2>
      {graphs.length === 0 ? (
        <p className="text-[12px] text-ink-faint">Board declared no graphs[].</p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {graphs.map((g) => (
            <GraphCard key={g.id} graph={g} accent={accent} bus={bus} />
          ))}
        </div>
      )}
    </div>
  );
}
