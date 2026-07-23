"use client";

import { useState } from "react";
import type { ActionSpec } from "@/lib/types";
import { ActionModal } from "./ActionModal";
import { useToast } from "./Toast";

// Pyro-specific ids get their own panel (PyroPanel.tsx) — skip them here so
// they aren't rendered twice, same rule as the vanilla dashboard's ui.js.
const PYRO_IDS = new Set(["arm", "disarm", "prime", "fire", "deploy_ready", "flight_mode", "safe"]);

export function ActionsPanel({
  actions,
  hasPyro,
  onInvoke,
}: {
  actions: ActionSpec[];
  hasPyro: boolean;
  onInvoke: (id: string, args: Record<string, string>) => Promise<string>;
}) {
  const [pending, setPending] = useState<ActionSpec | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();
  const rest = actions.filter((a) => !PYRO_IDS.has(a.id) || !hasPyro);

  const fire = async (a: ActionSpec, args: Record<string, string>) => {
    setBusy(a.id);
    const reply = await onInvoke(a.id, args);
    toast.show(reply);
    setBusy(null);
    setPending(null);
  };

  const click = (a: ActionSpec) => {
    if (a.confirm || (a.args && a.args.length)) {
      setPending(a);
    } else {
      fire(a, {});
    }
  };

  return (
    <div className="glass rounded-[10px] p-3">
      <h2 className="mb-2.5 font-display text-[12px] tracking-wide text-ink-dim label-caps">Actions</h2>
      {rest.length === 0 ? (
        <p className="text-[12px] text-ink-faint">No other actions.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {rest.map((a) => (
            <button
              key={a.id}
              onClick={() => click(a)}
              disabled={busy === a.id}
              className={
                a.danger
                  ? "btn-physical btn-physical-danger rounded-[6px] px-3 py-1.5 text-[11px] font-bold label-caps disabled:opacity-50"
                  : "pill px-3 py-1.5 text-[11px] font-medium hover:border-cyan-dim hover:!text-cyan disabled:opacity-40"
              }
            >
              {busy === a.id ? "…" : a.label}
            </button>
          ))}
        </div>
      )}
      {pending && (
        <ActionModal action={pending} onCancel={() => setPending(null)} onConfirm={(args) => fire(pending, args)} />
      )}
    </div>
  );
}
