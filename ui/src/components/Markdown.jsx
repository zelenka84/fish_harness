import { memo, useMemo, useState } from "react";
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

/**
 * resolveSrc: maps relative image paths (Markdown previews of workspace files).
 * onLink: handles relative links (e.g. open another file in the IDE).
 */
export default memo(function Markdown({ text, streaming, resolveSrc, onLink, className = "" }) {
  const comps = useMemo(() => {
    if (!resolveSrc && !onLink) return components;
    const external = (href = "") => /^([a-z]+:|#|\/\/)/i.test(href);
    return {
      ...components,
      img: ({ src, alt }) => <img src={resolveSrc && !external(src) ? resolveSrc(src) : src} alt={alt || ""} loading="lazy" />,
      a: ({ href, children }) =>
        onLink && href && !external(href) ? (
          <a href={href} onClick={(e) => (e.preventDefault(), onLink(href))}>{children}</a>
        ) : href?.startsWith("#") ? (
          <a href={href}>{children}</a>
        ) : (
          <a href={href} target="_blank" rel="noreferrer">{children}</a>
        ),
    };
  }, [resolveSrc, onLink]);
  return (
    <div className={`md ${streaming ? "cursor-blink" : ""} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]} components={comps}>
        {text}
      </ReactMarkdown>
    </div>
  );
});
