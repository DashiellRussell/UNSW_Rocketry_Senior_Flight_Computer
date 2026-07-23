/**
 * lib/builder/descriptor.ts — BuilderBlock[] <-> Descriptor conversion.
 * `blocksToDescriptor` is what feeds both the live preview (via
 * normaliseProfile) and the FCD1 output panel — one source of truth so the
 * preview can never drift from the exported line.
 */
import type { Descriptor, ActionSpec, Caps, CheckSpec, GraphSpec, ImuSpec, ParamSpec, RailSpec } from "@/lib/types";
import type { BuilderBlock, MetaData } from "./types";
import { uid } from "./types";

export function blocksToDescriptor(blocks: BuilderBlock[]): Descriptor {
  const meta = (blocks.find((b) => b.kind === "meta")?.data as MetaData | undefined) || {
    name: "MY BOARD",
    sub: "",
    fw: "",
    accent: "cyan",
  };
  const imuBlock = blocks.find((b) => b.kind === "imu");
  const capsBlock = blocks.find((b) => b.kind === "caps");

  const checks = blocks.filter((b) => b.kind === "check").map((b) => b.data as CheckSpec);
  const rails = blocks.filter((b) => b.kind === "rail").map((b) => b.data as RailSpec);
  const graphs = blocks.filter((b) => b.kind === "graph").map((b) => b.data as GraphSpec);
  const params = blocks.filter((b) => b.kind === "param").map((b) => b.data as ParamSpec);
  const actions = blocks.filter((b) => b.kind === "action").map((b) => b.data as ActionSpec);
  const imu = (imuBlock?.data as ImuSpec | undefined) || null;

  // `tlm[]` is documentation-only (the parser tolerates any keys) but real
  // boards declare it so operators know what to expect — auto-derive it
  // here from every key actually referenced by the rest of the descriptor,
  // so the exported line is complete without the user re-typing it.
  const tlmKeys = new Set<string>();
  tlmKeys.add("t_ms");
  tlmKeys.add("state");
  for (const c of checks) if (c.check) tlmKeys.add(c.check);
  for (const r of rails) tlmKeys.add(r.id);
  for (const g of graphs) tlmKeys.add(g.id);
  if (imu) for (const k of imu.accel) tlmKeys.add(k);
  if (capsBlock && Number((capsBlock.data as Caps).pyro || 0) > 0) {
    tlmKeys.add("armed");
    const n = Number((capsBlock.data as Caps).pyro || 0);
    for (let ch = 1; ch <= n; ch++) {
      tlmKeys.add(`cont${ch}`);
      tlmKeys.add(`dtok${ch}`);
    }
  }

  const descriptor: Descriptor = {
    p: "fcd/1",
    name: meta.name || "MY BOARD",
    sub: meta.sub || undefined,
    fw: meta.fw || undefined,
    accent: meta.accent || undefined,
    checks: checks.length ? checks : undefined,
    rails: rails.length ? rails : undefined,
    graphs: graphs.length ? graphs : undefined,
    tlm: Array.from(tlmKeys),
    params: params.length ? params : undefined,
    actions: actions.length ? actions : undefined,
    caps: capsBlock ? (capsBlock.data as Caps) : undefined,
    imu: imu || undefined,
  };
  return descriptor;
}

/** Reverse direction — load an existing descriptor (e.g. pasted `FCD1 {...}`
 *  line) back into editable blocks. */
export function descriptorToBlocks(d: Descriptor): BuilderBlock[] {
  const blocks: BuilderBlock[] = [];
  blocks.push({
    uid: uid(),
    kind: "meta",
    data: { name: d.name || "MY BOARD", sub: d.sub || "", fw: d.fw || "", accent: d.accent || "cyan" },
  });
  for (const c of d.checks || []) blocks.push({ uid: uid(), kind: "check", data: c });
  for (const r of d.rails || []) blocks.push({ uid: uid(), kind: "rail", data: r });
  for (const g of d.graphs || []) blocks.push({ uid: uid(), kind: "graph", data: g });
  for (const p of d.params || []) blocks.push({ uid: uid(), kind: "param", data: p });
  for (const a of d.actions || []) blocks.push({ uid: uid(), kind: "action", data: a });
  if (d.imu) blocks.push({ uid: uid(), kind: "imu", data: d.imu });
  if (d.caps) blocks.push({ uid: uid(), kind: "caps", data: d.caps });
  return blocks;
}

/** Build the full `FCD1 {json}` wire line, exactly as firmware would emit
 *  it in reply to `whoami` (see lib/fcd.ts's parseDescriptor). */
export function toFcd1Line(d: Descriptor): string {
  return `FCD1 ${JSON.stringify(d)}`;
}
