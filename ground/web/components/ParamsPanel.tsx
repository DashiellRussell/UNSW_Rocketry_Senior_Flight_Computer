"use client";

import { useState } from "react";
import type { ParamSpec } from "@/lib/types";

function ParamRow({ p, onSet }: { p: ParamSpec; onSet: (id: string, value: string) => Promise<string> }) {
  const initial = p.type === "bool" ? (p.value ? "on" : "off") : String(p.value ?? "");
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setStatus({ text: "…", ok: true });
    const reply = await onSet(p.id, value);
    setStatus({ text: reply, ok: !reply.startsWith("ERR") });
    setBusy(false);
  };

  return (
    <div className="frost flex flex-wrap items-center gap-2 px-2.5 py-1.5">
      <div className="min-w-[140px] flex-1 text-[11px] text-ink">
        {p.label || p.id}
        {p.unit && <span className="ml-1 text-ink-faint">({p.unit})</span>}
      </div>
      {p.type === "enum" && p.values ? (
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="rounded border border-hairline-bright bg-bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-cyan"
        >
          {p.values.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : p.type === "bool" ? (
        <select
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="rounded border border-hairline-bright bg-bg-panel px-2 py-1 text-[12px] text-ink outline-none focus:border-cyan"
        >
          <option value="off">off</option>
          <option value="on">on</option>
        </select>
      ) : (
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={p.min != null || p.max != null ? `${p.min ?? ""}..${p.max ?? ""}` : undefined}
          className="w-28 rounded border border-hairline-bright bg-bg-panel px-2 py-1 text-[12px] tabular text-ink outline-none focus:border-cyan"
        />
      )}
      <button
        onClick={submit}
        disabled={busy}
        className="rounded border border-hairline-bright px-2.5 py-1 text-[11px] font-medium text-ink-dim transition hover:border-cyan-dim hover:text-cyan disabled:opacity-40"
      >
        set
      </button>
      {status && (
        <span className={`text-[11px] tabular ${status.ok ? "text-ink-faint" : "text-red"}`}>{status.text}</span>
      )}
    </div>
  );
}

export function ParamsPanel({
  params,
  onSet,
}: {
  params: ParamSpec[];
  onSet: (id: string, value: string) => Promise<string>;
}) {
  const visible = params.filter((p) => p.id !== "fire_mode");
  return (
    <div className="glass rounded-[10px] p-3">
      <h2 className="mb-2.5 font-display text-[12px] tracking-wide text-ink-dim label-caps">Parameters</h2>
      {visible.length === 0 ? (
        <p className="text-[12px] text-ink-faint">Board declared no params[].</p>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((p) => (
            <ParamRow key={p.id} p={p} onSet={onSet} />
          ))}
        </div>
      )}
    </div>
  );
}
