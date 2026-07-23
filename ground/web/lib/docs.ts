/**
 * docs.ts — server-only helpers that read the vendored protocol docs at
 * BUILD time (fs, not fetch) so the static export stays fully self-contained.
 *
 * Source of truth: docs/fcd-protocol.md and docs/fcd-implementer-prompts.md
 * in the repo root, vendored 1:1 into ground/web/content/ so this app never
 * reaches outside its own directory at build or deploy time. Re-copy those
 * two files here if the source docs change — nothing in this module hand-
 * retypes their content.
 *
 * Not marked 'use client' — only ever imported from Server Components
 * (app/protocol/page.tsx), so `node:fs` is safe to use here.
 */
import fs from "node:fs";
import path from "node:path";

const CONTENT_DIR = path.join(process.cwd(), "content");

export function readProtocolMarkdown(): string {
  return fs.readFileSync(path.join(CONTENT_DIR, "fcd-protocol.md"), "utf8");
}

export interface ImplementerPrompts {
  esp32: string;
  stm32: string;
}

/**
 * Parses the two ```text fenced code blocks out of fcd-implementer-prompts.md
 * — one following "## Prompt A — ESP32 ..." and one following
 * "## Prompt B — STM32 ...". Keeps the .md as the single source of truth;
 * if its headings or fences change shape, this throws loudly at build time
 * rather than silently shipping a stale/empty prompt.
 */
export function readImplementerPrompts(): ImplementerPrompts {
  const raw = fs.readFileSync(path.join(CONTENT_DIR, "fcd-implementer-prompts.md"), "utf8");

  const extract = (headingMatch: RegExp): string => {
    const headingIdx = raw.search(headingMatch);
    if (headingIdx === -1) {
      throw new Error(`fcd-implementer-prompts.md: heading not found for ${headingMatch}`);
    }
    const fenceStart = raw.indexOf("```text", headingIdx);
    if (fenceStart === -1) {
      throw new Error(`fcd-implementer-prompts.md: no \`\`\`text fence after ${headingMatch}`);
    }
    const bodyStart = raw.indexOf("\n", fenceStart) + 1;
    const fenceEnd = raw.indexOf("\n```", bodyStart);
    if (fenceEnd === -1) {
      throw new Error(`fcd-implementer-prompts.md: unterminated fence after ${headingMatch}`);
    }
    return raw.slice(bodyStart, fenceEnd).replace(/\s+$/, "");
  };

  return {
    esp32: extract(/^##\s+Prompt A.*$/m),
    stm32: extract(/^##\s+Prompt B.*$/m),
  };
}
