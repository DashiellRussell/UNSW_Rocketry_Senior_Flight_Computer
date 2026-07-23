import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

/**
 * MarkdownDoc — renders a markdown string with the mission-control design
 * system: proper heading hierarchy, styled tables (horizontally scrollable),
 * monospace fenced code blocks, cyan links. Server Component (no hooks) so
 * the whole spec is rendered to static HTML at build time.
 */

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mb-2.5 mt-6 font-display text-[19px] leading-tight tracking-wide text-ink first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 mt-6 border-t border-hairline pt-8 font-display text-[19px] tracking-wide text-ink first:mt-0 first:border-0 first:pt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2.5 mt-7 font-display text-[13px] tracking-wide text-cyan">{children}</h3>
  ),
  h4: ({ children }) => <h4 className="mb-2 mt-5 text-[12px] font-bold text-ink label-caps">{children}</h4>,
  p: ({ children }) => <p className="mb-3.5 text-[14px] leading-relaxed text-ink-dim">{children}</p>,
  a: ({ children, href }) => (
    <a href={href} className="text-cyan underline decoration-cyan-dim underline-offset-2 hover:text-ink">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }) => <em className="text-ink">{children}</em>,
  ul: ({ children }) => <ul className="mb-3.5 ml-5 list-disc space-y-1.5 text-[14px] text-ink-dim marker:text-cyan-dim">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-3.5 ml-5 list-decimal space-y-1.5 text-[14px] text-ink-dim marker:text-cyan-dim">{children}</ol>
  ),
  li: ({ children }) => <li className="pl-1 leading-relaxed">{children}</li>,
  hr: () => <hr className="my-8 border-hairline" />,
  blockquote: ({ children }) => (
    <blockquote className="mb-3.5 border-l-2 border-cyan-dim bg-cyan/5 py-2 pl-4 text-[12px] text-ink-dim">
      {children}
    </blockquote>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = /language-/.test(className || "");
    if (!isBlock) {
      return (
        <code className="rounded bg-bg-inset px-1.5 py-0.5 font-mono text-[0.9em] text-cyan" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={`font-mono text-[12.5px] leading-relaxed text-ink ${className || ""}`} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="frost mb-2.5 overflow-x-auto p-4 text-[12.5px] leading-relaxed">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="frost mb-2.5 overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-[12px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-black/20">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-hairline last:border-0">{children}</tr>,
  th: ({ children }) => (
    <th className="whitespace-nowrap px-3.5 py-2.5 text-left text-[11px] font-bold text-ink-dim label-caps">
      {children}
    </th>
  ),
  td: ({ children }) => <td className="px-3.5 py-2.5 align-top text-ink-dim">{children}</td>,
};

export function MarkdownDoc({ markdown }: { markdown: string }) {
  return (
    <div className="min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
