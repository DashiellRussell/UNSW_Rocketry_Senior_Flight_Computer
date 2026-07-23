"use client";

import { useState } from "react";
import type { ActionSpec } from "@/lib/types";

export interface ActionModalProps {
  action: ActionSpec;
  onConfirm: (args: Record<string, string>) => void;
  onCancel: () => void;
}

/**
 * One modal that both prompts for an action's declared args[] and, if the
 * action carries a `confirm` token, requires it typed exactly — replaces the
 * vanilla dashboard's window.prompt() chain with an inline form.
 */
export function ActionModal({ action, onConfirm, onCancel }: ActionModalProps) {
  const [args, setArgs] = useState<Record<string, string>>(
    Object.fromEntries((action.args || []).map((a) => [a.id, a.values ? a.values[0] : ""]))
  );
  const [token, setToken] = useState("");
  const danger = !!action.danger;
  const needsToken = !!action.confirm;
  const tokenOk = !needsToken || token.trim() === action.confirm;
  const argsOk = (action.args || []).every((a) => String(args[a.id] ?? "").trim() !== "" || a.min === 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className={`glass rise-in w-[min(92vw,420px)] rounded-[10px] p-3 ${danger ? "!border-red-dim" : ""}`}
        style={danger ? { background: "linear-gradient(160deg, rgba(122,34,43,0.45), rgba(122,34,43,0.18))" } : undefined}
      >
        <h3 className={`font-display text-[13px] tracking-wide ${danger ? "text-red" : "text-ink"}`}>{action.label}</h3>
        {danger && (
          <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">
            Danger action — still passes through the board&apos;s own interlocks (armed, continuity, key switch).
          </p>
        )}

        {(action.args || []).map((a) => (
          <label key={a.id} className="mt-3 block text-[12px] text-ink-dim">
            {a.label || a.id}
            {a.values ? (
              <select
                value={args[a.id]}
                onChange={(e) => setArgs((s) => ({ ...s, [a.id]: e.target.value }))}
                className="mt-1 w-full rounded border border-hairline-bright bg-bg-inset px-2.5 py-1.5 text-[12px] text-ink outline-none focus:border-cyan"
              >
                {a.values.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={args[a.id] ?? ""}
                onChange={(e) => setArgs((s) => ({ ...s, [a.id]: e.target.value }))}
                placeholder={a.min != null || a.max != null ? `${a.min ?? ""}..${a.max ?? ""}` : undefined}
                className="mt-1 w-full rounded border border-hairline-bright bg-bg-inset px-2.5 py-1.5 text-[12px] tabular text-ink outline-none focus:border-cyan"
              />
            )}
          </label>
        ))}

        {needsToken && (
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={`type ${action.confirm} to confirm`}
            autoComplete="off"
            className="mt-4 w-full rounded border border-hairline-bright bg-bg-inset px-3 py-2 font-mono text-sm uppercase tracking-widest text-ink outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-faint focus:border-cyan"
          />
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="pill px-3 py-1.5 text-[11px] hover:!text-ink">
            Cancel
          </button>
          <button
            disabled={!tokenOk || !argsOk}
            onClick={() => onConfirm(args)}
            className={`btn-physical rounded-[6px] px-3.5 py-1.5 text-[11px] font-bold tracking-wide label-caps disabled:cursor-not-allowed disabled:opacity-40 ${
              danger ? "btn-physical-danger" : "btn-physical-accent"
            }`}
          >
            {needsToken ? `Confirm ${action.confirm}` : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
