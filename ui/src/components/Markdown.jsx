import { memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Copy, Check } from "lucide-react";

function CodeBlock({ className, children }) {
  const [copied, setCopied] = useState(false);
  const lang = /language-(\w+)/.exec(className || "")?.[1] || "text";
  const text = extractText(children);
  return (
    <div className="codeblock">
      <div className="codeblock-head">
        <span>{lang}</span>
        <button
          className="btn ghost xs"
          onClick={() => {
            navigator.clipboard?.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1400);
          }}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

function extractText(node) {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  return extractText(node.props?.children);
}

const components = {
  pre: ({ children }) => <>{children}</>,
  code({ className, children, node }) {
    const isBlock = /language-/.test(className || "") || String(extractText(children)).includes("\n");
    if (!isBlock) return <code>{children}</code>;
    return <CodeBlock className={className}>{children}</CodeBlock>;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

export default memo(function Markdown({ text, streaming }) {
  return (
    <div className={`md ${streaming ? "cursor-blink" : ""}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
