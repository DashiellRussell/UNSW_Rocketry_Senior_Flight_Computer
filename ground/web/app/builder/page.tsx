"use client";

/**
 * /builder — the visual FCD/1 descriptor builder + live WYSIWYG preview.
 * Compose a board out of draggable blocks (Palette.tsx -> CanvasEditor.tsx),
 * see the REAL dashboard components render it against a built-in mock
 * telemetry generator (PreviewPane.tsx), then copy the composed `FCD1
 * {json}` out (OutputPanel.tsx) to paste into firmware's `whoami` reply.
 * The working descriptor persists in localStorage across reloads.
 */
import { useEffect, useMemo, useState } from "react";
import type { BuilderBlock, BlockKind } from "@/lib/builder/types";
import { blocksToDescriptor } from "@/lib/builder/descriptor";
import { BUILDER_STORAGE_KEY, defaultBlocks } from "@/lib/builder/defaultState";
import { Palette } from "@/components/builder/Palette";
import { CanvasEditor } from "@/components/builder/CanvasEditor";
import { PreviewPane } from "@/components/builder/PreviewPane";
import { OutputPanel } from "@/components/builder/OutputPanel";

/**
 * Section divider between the builder's major zones (canvas -> live preview
 * -> generated code) — an uppercase tracking-widest label + a hairline rule
 * spanning the rest of the row, same "small dot + label-caps" mission-
 * control language used elsewhere (BoardHeader, the /protocol hero). Makes
 * the hand-off from "you're editing" to "this is what a board would show"
 * to "this is the code to paste" read as three distinct zones, not one
 * continuous scroll.
 */
function SectionDivider({ label, accent = "cyan" }: { label: string; accent?: "cyan" | "amber" }) {
  return (
    <div className="mb-2.5 mt-8 flex items-center gap-3 first:mt-0">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{
          background: accent === "amber" ? "var(--color-amber)" : "var(--color-cyan)",
          boxShadow: `0 0 6px ${accent === "amber" ? "var(--color-amber)" : "var(--color-cyan)"}`,
        }}
      />
      <span className="label-caps shrink-0 text-[11px] font-semibold tracking-[0.18em] text-ink-dim">{label}</span>
      <span className="h-px flex-1 bg-hairline-bright" />
    </div>
  );
}

function loadInitial(): BuilderBlock[] {
  if (typeof window === "undefined") return defaultBlocks();
  try {
    const raw = window.localStorage.getItem(BUILDER_STORAGE_KEY);
    if (!raw) return defaultBlocks();
    const parsed = JSON.parse(raw) as BuilderBlock[];
    return Array.isArray(parsed) && parsed.length ? parsed : defaultBlocks();
  } catch {
    return defaultBlocks();
  }
}

export default function BuilderPage() {
  // Server render and first client render must agree (hydration) — start
  // from the deterministic default, then swap in localStorage after mount.
  const [blocks, setBlocksState] = useState<BuilderBlock[]>(defaultBlocks());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setBlocksState(loadInitial());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(BUILDER_STORAGE_KEY, JSON.stringify(blocks));
  }, [blocks, hydrated]);

  const setBlocks = (fn: (prev: BuilderBlock[]) => BuilderBlock[]) => setBlocksState(fn);

  const descriptor = useMemo(() => blocksToDescriptor(blocks), [blocks]);
  const presentKinds = useMemo(() => new Set(blocks.map((b) => b.kind)) as Set<BlockKind>, [blocks]);

  return (
    <main className="mx-auto max-w-[1600px] px-4 pb-8 pt-4">
      <div className="glass sweep-in mb-2.5 rounded-[10px] px-4 py-3">
        <h1 className="font-display text-[16px] font-semibold leading-none tracking-wide text-ink">FCD/1 Descriptor Builder</h1>
        <p className="mt-1.5 text-[11px] text-ink-dim">
          Drag blocks into the canvas, watch the real dashboard render them live against mock telemetry, then copy the
          composed <code className="text-cyan">FCD1</code> line into your board&apos;s firmware.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-[240px_1fr]">
        <div className="xl:sticky xl:top-4 xl:self-start">
          <Palette presentKinds={presentKinds} />
          <button
            onClick={() => {
              if (window.confirm("Reset the builder to the default starter board? This clears your current descriptor.")) {
                setBlocks(() => defaultBlocks());
              }
            }}
            className="pill mt-2.5 w-full px-3 py-1.5 text-[11px] label-caps hover:!text-red"
          >
            Reset to default
          </button>
        </div>
        <CanvasEditor blocks={blocks} setBlocks={setBlocks} />
      </div>

      <SectionDivider label="Live preview" accent="cyan" />
      <PreviewPane descriptor={descriptor} />

      <SectionDivider label="FCD1 output" accent="amber" />
      <OutputPanel descriptor={descriptor} onImport={(imported) => setBlocks(() => imported)} />
    </main>
  );
}
