import type { Metadata } from "next";
import { readProtocolMarkdown, readImplementerPrompts } from "@/lib/docs";
import { MarkdownDoc } from "@/components/MarkdownDoc";
import { PromptSwitcher } from "@/components/PromptSwitcher";

export const metadata: Metadata = {
  title: "FCD/1 Protocol — OZONE Ground Station",
  description: "The full FCD/1 flight-computer descriptor spec, plus copy-pastable prompts to implement it on your own board.",
};

// The sticky top nav (brand, Console/Protocol pills, connection cluster) is
// shared across every route — see components/TopNav.tsx, mounted once in
// app/layout.tsx — so this page only owns its own content below it.
export default function ProtocolPage() {
  const markdown = readProtocolMarkdown();
  const prompts = readImplementerPrompts();

  return (
    <main className="mx-auto max-w-[1400px] px-4 pb-10 pt-4">
      <div className="rise-in mb-5">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-cyan" style={{ boxShadow: "0 0 10px var(--color-cyan)" }} />
          <span className="label-caps text-[11px] text-ink-faint">fcd/1 · protocol reference</span>
        </div>
        <h1 className="font-display text-[18px] leading-tight tracking-wide text-ink">The FCD Protocol Spec Hub</h1>
        <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-ink-dim">
          FCD is a tiny, board-agnostic, self-describing protocol — implement it on any board and this
          ground station (or any other FCD-speaking client) drives it with zero board-specific code. Copy
          a starter prompt below, or read the full wire spec further down the page.
        </p>
        <div className="mt-4 flex gap-2">
          <a href="#prompts" className="pill px-3 py-1.5 text-[11px] hover:border-cyan-dim hover:!text-cyan">
            Implementation prompts
          </a>
          <a href="#spec" className="pill px-3 py-1.5 text-[11px] hover:border-cyan-dim hover:!text-cyan">
            Full spec
          </a>
        </div>
      </div>

      <section id="prompts" className="scroll-mt-20">
        <PromptSwitcher prompts={prompts} />
      </section>

      <section id="spec" className="glass mt-6 scroll-mt-20 rounded-[10px] px-6 py-5 sm:px-10">
        <MarkdownDoc markdown={markdown} />
      </section>
    </main>
  );
}
