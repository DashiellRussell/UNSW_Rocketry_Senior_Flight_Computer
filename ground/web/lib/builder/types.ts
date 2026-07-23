/**
 * lib/builder/types.ts — the FCD builder's own working model. A "block" is
 * one draggable/editable unit in the canvas; `blocksToDescriptor` (see
 * ./descriptor.ts) flattens the whole board into a real fcd/1 `Descriptor`
 * (lib/types.ts) — the SAME shape the firmware ships over `whoami` and the
 * SAME shape the real dashboard consumes, so the live preview is exact.
 *
 * `meta` / `imu` / `caps` are singleton blocks (a board has exactly one
 * name/sub/fw/accent, at most one imu orientation spec, at most one caps
 * flag-set) — the editor enforces at most one of each. `check` / `rail` /
 * `graph` / `param` / `action` are freely repeatable and reorderable.
 */
import type { ActionSpec, Caps, CheckSpec, GraphSpec, ImuSpec, ParamSpec, RailSpec } from "@/lib/types";

export interface MetaData {
  name: string;
  sub: string;
  fw: string;
  accent: string;
}

export type BlockKind = "meta" | "check" | "rail" | "graph" | "param" | "action" | "imu" | "caps";

export interface BlockOf<K extends BlockKind, D> {
  uid: string;
  kind: K;
  data: D;
}

export type BuilderBlock =
  | BlockOf<"meta", MetaData>
  | BlockOf<"check", CheckSpec>
  | BlockOf<"rail", RailSpec>
  | BlockOf<"graph", GraphSpec>
  | BlockOf<"param", ParamSpec>
  | BlockOf<"action", ActionSpec>
  | BlockOf<"imu", ImuSpec>
  | BlockOf<"caps", Caps>;

export const SINGLETON_KINDS: BlockKind[] = ["meta", "imu", "caps"];
export const ID_KINDS: BlockKind[] = ["check", "rail", "graph", "param", "action"];

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

/** A descriptor-facing `id` is only legal without whitespace — mirrors the
 *  TLM `key=value` tokenizer (lib/fcd.ts's KV_RE), which would silently
 *  mis-split on a spaced id. */
export function isValidId(id: string): boolean {
  return /^[A-Za-z0-9_.:-]+$/.test(id.trim()) && id.trim().length > 0;
}
