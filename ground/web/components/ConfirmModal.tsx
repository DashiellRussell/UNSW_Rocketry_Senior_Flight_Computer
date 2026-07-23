"use client";

import { useEffect, useRef, useState } from "react";

export interface ConfirmModalProps {
  title: string;
  body?: string;
  token?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Typed-token confirmation modal — used for every danger action (ARM, FIRE,
 * FLIGHT, STOP, ERASE). Ported from js/ui.js openConfirmModal. The board is
 * still the sole safety authority; this is strictly an operator-side guard
 * against a fat-fingered click.
 */
export function ConfirmModal({ title, body, token, danger, onConfirm, onCancel }: ConfirmModalProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const ok = !token || value.trim() === token;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

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
        <h3 className={`font-display text-[13px] tracking-wide ${danger ? "text-red" : "text-ink"}`}>{title}</h3>
        {body && <p className="mt-2 text-[12px] leading-relaxed text-ink-dim">{body}</p>}
        {token && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && ok) onConfirm();
            }}
            placeholder={`type ${token} to confirm`}
            autoComplete="off"
            className="mt-4 w-full rounded border border-hairline-bright bg-bg-inset px-3 py-2 font-mono text-sm uppercase tracking-widest text-ink outline-none placeholder:normal-case placeholder:tracking-normal placeholder:text-ink-faint focus:border-cyan"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className="pill px-3 py-1.5 text-[11px] hover:!text-ink">
            Cancel
          </button>
          <button
            disabled={!ok}
            onClick={onConfirm}
            className={`btn-physical rounded-[6px] px-3.5 py-1.5 text-[11px] font-bold tracking-wide label-caps disabled:cursor-not-allowed disabled:opacity-40 ${
              danger ? "btn-physical-danger" : "btn-physical-accent"
            }`}
          >
            {danger ? `Confirm ${token || ""}` : "Confirm"}
          </button>
        </div>
      </div>
    </div>
  );
}
