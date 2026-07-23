"use client";

/**
 * Palette.tsx — zone 1: draggable block chips. Native HTML5 DnD only (no
 * new dependency) — dataTransfer carries `{ source: "palette", kind }` as
 * JSON, read by CanvasEditor's onDrop. Singleton kinds (meta/imu/caps)
 * disable themselves once present, since a board only has one of each.
 */
import { PALETTE } from "@/lib/builder/paletteDefs";
import type { BlockKind } from "@/lib/builder/types";

export const DND_MIME = "application/x-fcd-builder";

export function Palette({ presentKinds }: { presentKinds: Set<BlockKind> }) {
  return (
    <div className="glass flex flex-col gap-2 rounded-[10px] p-3">
      <h2 className="font-display text-[12px] tracking-wide text-ink-dim label-caps">Palette</h2>
      <p className="text-[10px] leading-snug text-ink-faint">Drag a block into the canvas to add it.</p>
      <div className="flex flex-col gap-1.5">
        {PALETTE.map((def) => {
          const already = def.singleton && presentKinds.has(def.kind);
          return (
            <div
              key={def.kind}
              draggable={!already}
              onDragStart={(e) => {
                if (already) return;
                e.dataTransfer.setData(DND_MIME, JSON.stringify({ source: "palette", kind: def.kind }));
                e.dataTransfer.effectAllowed = "copy";
              }}
              className={`pill !rounded-[5px] flex flex-col gap-0.5 px-3 py-2 text-left transition ${
                already ? "cursor-not-allowed opacity-40" : "cursor-grab hover:!text-cyan active:cursor-grabbing"
              }`}
            >
              <span className="text-[11px] font-semibold text-ink">{def.title}</span>
              <span className="text-[10px] text-ink-faint">{already ? "already added — edit it below" : def.blurb}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
