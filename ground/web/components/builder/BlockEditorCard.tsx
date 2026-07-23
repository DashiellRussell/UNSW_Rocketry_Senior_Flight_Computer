"use client";

/**
 * BlockEditorCard.tsx — chrome shared by every dropped block: drag handle
 * (native HTML5 DnD, reorder within the canvas), kind badge, delete button,
 * and the kind-specific form body (BlockForms.tsx).
 */
import type { BuilderBlock } from "@/lib/builder/types";
import { isValidId } from "@/lib/builder/types";
import {
  ActionForm,
  CapsForm,
  CheckForm,
  GraphForm,
  ImuForm,
  MetaForm,
  ParamForm,
  RailForm,
} from "./BlockForms";

const KIND_LABEL: Record<BuilderBlock["kind"], string> = {
  meta: "BOARD META",
  check: "CHECK",
  rail: "RAIL",
  graph: "GRAPH",
  param: "PARAM",
  action: "ACTION",
  imu: "IMU ORIENTATION",
  caps: "CAPS FLAGS",
};

export function BlockEditorCard({
  block,
  duplicate,
  draggable,
  dragging,
  onChange,
  onRemove,
  onDragStart,
  onDragOver,
  onDragEnd,
  removable = true,
}: {
  block: BuilderBlock;
  duplicate: boolean;
  draggable: boolean;
  dragging: boolean;
  onChange: (data: Partial<BuilderBlock["data"]>) => void;
  onRemove: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  removable?: boolean;
}) {
  const idValue = (block.data as { id?: string }).id;
  const invalid = idValue != null ? !isValidId(idValue) : false;

  return (
    <div
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={`frost flex flex-col gap-2 p-2.5 transition-opacity ${dragging ? "opacity-40" : "opacity-100"} ${
        draggable ? "cursor-grab active:cursor-grabbing" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {draggable && <span className="text-ink-faint select-none">⠿</span>}
          <span className="label-caps text-[9px] tracking-wider text-ink-faint">{KIND_LABEL[block.kind]}</span>
        </div>
        {removable && (
          <button onClick={onRemove} className="pill px-2 py-0.5 text-[9px] label-caps hover:!text-red">
            delete
          </button>
        )}
      </div>

      {block.kind === "meta" && <MetaForm data={block.data} onChange={onChange} />}
      {block.kind === "check" && (
        <CheckForm data={block.data} onChange={onChange} invalid={invalid} duplicate={duplicate} />
      )}
      {block.kind === "rail" && (
        <RailForm data={block.data} onChange={onChange} invalid={invalid} duplicate={duplicate} />
      )}
      {block.kind === "graph" && (
        <GraphForm data={block.data} onChange={onChange} invalid={invalid} duplicate={duplicate} />
      )}
      {block.kind === "param" && (
        <ParamForm data={block.data} onChange={onChange} invalid={invalid} duplicate={duplicate} />
      )}
      {block.kind === "action" && (
        <ActionForm data={block.data} onChange={onChange} invalid={invalid} duplicate={duplicate} />
      )}
      {block.kind === "imu" && <ImuForm data={block.data} onChange={onChange} />}
      {block.kind === "caps" && <CapsForm data={block.data} onChange={onChange} />}
    </div>
  );
}
