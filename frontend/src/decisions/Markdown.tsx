import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * An ADR section as rendered Markdown (GitHub flavour: tables, task lists).
 * Raw HTML in the text is shown as text, never run.
 */
export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
