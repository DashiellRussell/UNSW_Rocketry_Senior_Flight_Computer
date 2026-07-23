"use client";

/**
 * CanvasEditor.tsx — zone 2: the drop target + editable block list.
 * - Dropping a palette chip (see Palette.tsx) appends a fresh block.
 * - Dragging a block already in the canvas reorders the list live.
 * - Singleton blocks (meta/imu/caps) can only exist once; meta is required
 *   and never deletable (a descriptor without `name` isn't renderable).
 */
import { useState } from "react";
import type { BuilderBlock, BlockKind } from "@/lib/builder/types";
import { ID_KINDS } from "@/lib/builder/types";
import { PALETTE } from "@/lib/builder/paletteDefs";
import { BlockEditorCard } from "./BlockEditorCard";
import { DND_MIME } from "./Palette";

function idDuplicateSet(blocks: BuilderBlock[], kind: BlockKind): Set<string> {
  const counts = new Map<string, number>();
  for (const b of blocks) {
    if (b.kind !== kind) continue;
    const id = (b.data as { id?: string }).id;
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  const dupes = new Set<string>();
  for (const [id, n] of counts) if (n > 1) dupes.add(id);
  return dupes;
}

export function CanvasEditor({
  blocks,
  setBlocks,
}: {
  blocks: BuilderBlock[];
  setBlocks: (fn: (prev: BuilderBlock[]) => BuilderBlock[]) => void;
}) {
  const [draggingUid, setDraggingUid] = useState<string | null>(null);
  const [overCanvas, setOverCanvas] = useState(false);

  const dupSets = new Map<BlockKind, Set<string>>(ID_KINDS.map((k) => [k, idDuplicateSet(blocks, k)]));

  const handleDropOnCanvas = (e: React.DragEvent) => {
    e.preventDefault();
    setOverCanvas(false);
    const raw = e.dataTransfer.getData(DND_MIME);
    if (!raw) return;
    const payload = JSON.parse(raw) as { source: string; kind: BlockKind };
    if (payload.source !== "palette") return;
    const def = PALETTE.find((p) => p.kind === payload.kind);
    if (!def) return;
    if (def.singleton && blocks.some((b) => b.kind === def.kind)) return; // already present
    setBlocks((prev) => [...prev, def.make(prev)]);
  };

  const reorder = (targetUid: string) => {
    if (!draggingUid || draggingUid === targetUid) return;
    setBlocks((prev) => {
      const from = prev.findIndex((b) => b.uid === draggingUid);
      const to = prev.findIndex((b) => b.uid === targetUid);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  return (
    <div
      className="glass flex flex-col gap-2 rounded-[10px] p-3"
      onDragOver={(e) => {
        e.preventDefault();
        setOverCanvas(true);
      }}
      onDragLeave={() => setOverCanvas(false)}
      onDrop={handleDropOnCanvas}
    >
      <h2 className="font-display text-[12px] tracking-wide text-ink-dim label-caps">Canvas</h2>
      <div
        className={`flex flex-col gap-2 rounded-[8px] p-1.5 transition ${
          overCanvas ? "outline outline-1 outline-cyan-dim bg-cyan/[0.04]" : ""
        }`}
      >
        {blocks.length === 0 && (
          <p className="p-4 text-center text-[12px] text-ink-faint">Drag blocks in from the palette to begin.</p>
        )}
        {blocks.map((b) => {
          const id = (b.data as { id?: string }).id;
          const duplicate = id ? dupSets.get(b.kind)?.has(id) ?? false : false;
          const draggable = b.kind !== "meta";
          return (
            <BlockEditorCard
              key={b.uid}
              block={b}
              duplicate={duplicate}
              draggable={draggable}
              dragging={draggingUid === b.uid}
              removable={b.kind !== "meta"}
              onChange={(patch) =>
                setBlocks((prev) => prev.map((x) => (x.uid === b.uid ? ({ ...x, data: { ...x.data, ...patch } } as BuilderBlock) : x)))
              }
              onRemove={() => setBlocks((prev) => prev.filter((x) => x.uid !== b.uid))}
              onDragStart={(e) => {
                setDraggingUid(b.uid);
                e.dataTransfer.setData(DND_MIME, JSON.stringify({ source: "canvas", uid: b.uid }));
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                reorder(b.uid);
              }}
              onDragEnd={() => setDraggingUid(null)}
            />
          );
        })}
      </div>
    </div>
  );
}
