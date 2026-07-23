"use client";

/**
 * OutputPanel.tsx — the composed `FCD1 {json}` wire line (+ raw descriptor
 * JSON), copy-to-clipboard, and an IMPORT box that parses a pasted FCD1
 * line (or bare JSON) back into editable blocks via descriptorToBlocks.
 */
import { useState } from "react";
import type { Descriptor } from "@/lib/types";
import { parseDescriptor } from "@/lib/fcd";
import { descriptorToBlocks, toFcd1Line } from "@/lib/builder/descriptor";
import type { BuilderBlock } from "@/lib/builder/types";

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          // clipboard API unavailable — the code block itself is selectable
        }
      }}
      className="btn-physical btn-physical-accent rounded-[6px] px-2.5 py-1 text-[10px] font-bold tracking-wider label-caps"
    >
      {copied ? "copied ✓" : "copy"}
    </button>
  );
}

export function OutputPanel({
  descriptor,
  onImport,
}: {
  descriptor: Descriptor;
  onImport: (blocks: BuilderBlock[]) => void;
}) {
  const fcd1 = toFcd1Line(descriptor);
  const json = JSON.stringify(descriptor, null, 2);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const doImport = () => {
    const text = importText.trim();
    if (!text) return;
    let parsed: Descriptor | null = null;
    if (/^FCD1\s/.test(text)) {
      parsed = parseDescriptor(text);
    } else {
      try {
        parsed = JSON.parse(text) as Descriptor;
      } catch {
        parsed = null;
      }
    }
    if (!parsed || !parsed.name) {
      setImportError("Couldn't parse a descriptor from that text — paste a full `FCD1 {...}` line or bare JSON.");
      return;
    }
    setImportError(null);
    onImport(descriptorToBlocks(parsed));
    setImportText("");
  };

  return (
    <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
      <div className="glass flex flex-col gap-2 rounded-[10px] p-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-[12px] tracking-wide text-ink-dim label-caps">Output — paste into your board&apos;s whoami reply</h2>
        </div>
        <div className="flex items-center justify-between">
          <span className="label-caps text-[9px] text-ink-faint">FCD1 line</span>
          <CopyButton text={fcd1} />
        </div>
        <pre className="frost max-h-40 overflow-auto p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-dim">
          {fcd1}
        </pre>
        <div className="flex items-center justify-between">
          <span className="label-caps text-[9px] text-ink-faint">raw descriptor JSON</span>
          <CopyButton text={json} />
        </div>
        <pre className="frost max-h-56 overflow-auto p-2.5 font-mono text-[10.5px] leading-relaxed text-ink-dim">
          {json}
        </pre>
      </div>

      <div className="glass flex flex-col gap-2 rounded-[10px] p-3">
        <h2 className="font-display text-[12px] tracking-wide text-ink-dim label-caps">Import an existing descriptor</h2>
        <p className="text-[10px] leading-snug text-ink-faint">
          Paste a board&apos;s `FCD1 {`{...}`}` reply (or bare JSON) to load it back into the builder for editing.
        </p>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder='FCD1 {"p":"fcd/1","name":"..."}'
          className="frost h-40 w-full resize-none p-2.5 font-mono text-[11px] text-ink outline-none focus:border-cyan"
        />
        {importError && <p className="text-[11px] text-red">{importError}</p>}
        <button
          onClick={doImport}
          disabled={!importText.trim()}
          className="btn-physical btn-physical-accent self-start rounded-[6px] px-3 py-1.5 text-[11px] font-bold label-caps disabled:opacity-40"
        >
          Load into builder
        </button>
      </div>
    </div>
  );
}
