"use client";

import { useEffect, useRef } from "react";
import type { LogLine } from "@/hooks/useFcdConnection";

const LEVEL_STYLE: Record<LogLine["level"], string> = {
  ERR: "text-red",
  WARN: "text-amber",
  INFO: "text-ink",
  DEBUG: "text-ink-faint",
};

export function LogPanel({ lines, counts }: { lines: LogLine[]; counts: { err: number; warn: number } }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  return (
    <div className="glass flex min-h-0 flex-col rounded-[10px] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-display text-[12px] tracking-wide text-ink-dim label-caps">Event log</h2>
        <div className="flex gap-1.5 text-[10px] tabular">
          <span className="pill border-red-dim px-1.5 py-0.5 !text-red">{counts.err} err</span>
          <span className="pill border-amber-dim px-1.5 py-0.5 !text-amber">{counts.warn} warn</span>
        </div>
      </div>
      <div ref={hostRef} className="frost h-[240px] overflow-y-auto p-1.5 font-mono text-[11px] leading-5">
        {lines.length === 0 && <p className="p-2 text-ink-faint">No events yet.</p>}
        {lines.map((l) => (
          <div key={l.id} className="flex gap-2 border-b border-white/[0.03] px-1 py-0.5 last:border-0">
            <span className="w-12 shrink-0 text-ink-faint tabular">{l.t}</span>
            <span className={`w-10 shrink-0 font-semibold ${LEVEL_STYLE[l.level]}`}>{l.level}</span>
            <span className="text-ink-dim">{l.msg}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
