"use client";

import { useState } from "react";
import type { ImplementerPrompts } from "@/lib/docs";

type Board = "esp32" | "stm32";

const LABEL: Record<Board, string> = { esp32: "ESP32", stm32: "STM32" };
const SUBTITLE: Record<Board, string> = {
  esp32: "Arduino / PlatformIO",
  stm32: "STM32Cube HAL / C",
};

export function PromptSwitcher({ prompts }: { prompts: ImplementerPrompts }) {
  const [board, setBoard] = useState<Board>("esp32");
  const [copied, setCopied] = useState(false);
  const text = prompts[board];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1900);
    } catch {
      /* clipboard permissions denied — the select-all-on-click still lets them copy manually */
    }
  };

  return (
    <div className="glass overflow-hidden rounded-[10px]">
      <div
        className="border-b border-hairline px-5 py-4"
        style={{
          background:
            "radial-gradient(ellipse 120% 140% at 0% 0%, rgba(63,215,255,0.09), transparent 60%), radial-gradient(ellipse 120% 140% at 100% 0%, rgba(255,180,84,0.07), transparent 60%)",
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-[14px] tracking-wide text-ink">Implement FCD on your board</h2>
            <p className="mt-1 max-w-[52ch] text-[12.5px] leading-relaxed text-ink-dim">
              Paste this straight into an AI coding assistant to scaffold an FCD/1-compliant flight
              computer — any FCD ground station (including this one) then drives it with zero
              board-specific client code.
            </p>
          </div>

          <div className="frost flex shrink-0 gap-1 !rounded-full p-1">
            {(["esp32", "stm32"] as Board[]).map((b) => (
              <button
                key={b}
                onClick={() => setBoard(b)}
                className={`rounded-full px-4 py-1.5 text-[12px] font-bold tracking-wide transition ${
                  board === b
                    ? "bg-cyan text-[#031820]"
                    : "border border-transparent text-ink-dim hover:border-cyan/40 hover:text-ink"
                }`}
              >
                {LABEL[b]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="p-3">
        <div className="mb-3 flex items-center justify-between">
          <span className="label-caps text-[11px] text-ink-faint">
            Prompt {board === "esp32" ? "A" : "B"} · {SUBTITLE[board]}
          </span>
          <button
            onClick={copy}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold tracking-wide transition ${
              copied ? "bg-green text-[#062015]" : "bg-cyan text-[#031820] hover:brightness-110"
            }`}
          >
            {copied ? "Copied!" : "Copy prompt"}
          </button>
        </div>
        <pre className="frost max-h-[480px] overflow-auto p-4 text-[12.5px] leading-relaxed text-ink">
          <code className="font-mono">{text}</code>
        </pre>
      </div>
    </div>
  );
}
