import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";

const fishTheme = EditorView.theme(
  {
    "&": { backgroundColor: "transparent", color: "var(--text)", fontSize: "13px", height: "100%" },
    ".cm-content": { fontFamily: "var(--mono)", caretColor: "var(--accent)", padding: "12px 0" },
    ".cm-scroller": { fontFamily: "var(--mono)", lineHeight: "1.65" },
    ".cm-gutters": { backgroundColor: "transparent", color: "var(--text-4)", border: "none", paddingLeft: "8px" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-2)" },
    ".cm-activeLine": { backgroundColor: "rgba(148,163,184,0.05)" },
    ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "rgba(45,212,191,0.22) !important" },
    ".cm-matchingBracket": { backgroundColor: "rgba(129,140,248,0.25)", outline: "none" },
    ".cm-foldPlaceholder": { background: "var(--surface-3)", border: "none", color: "var(--text-2)" },
    ".cm-tooltip": { background: "var(--glass-strong)", border: "1px solid var(--border-2)", borderRadius: "8px" },
    ".cm-panels": { background: "var(--surface)", color: "var(--text)" },
    ".cm-searchMatch": { backgroundColor: "rgba(251,191,36,0.25)" },
  },
  { dark: true },
);

const fishHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: "#c4b5fd" },
  { tag: [t.string, t.special(t.string), t.regexp], color: "#86efac" },
  { tag: [t.number, t.bool, t.null, t.atom], color: "#fca5a5" },
  { tag: [t.comment, t.lineComment, t.blockComment], color: "#5b6b85", fontStyle: "italic" },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: "#7dd3fc" },
  { tag: [t.typeName, t.className, t.namespace], color: "#fcd34d" },
  { tag: [t.propertyName, t.attributeName], color: "#5eead4" },
  { tag: [t.tagName], color: "#f9a8d4" },
  { tag: [t.heading], color: "#7dd3fc", fontWeight: "bold" },
  { tag: [t.link, t.url], color: "#60a5fa", textDecoration: "underline" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "bold" },
  { tag: [t.punctuation, t.bracket], color: "#94a3b8" },
]);

export function languageFor(file = "") {
  const ext = file.split(".").pop().toLowerCase();
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return [javascript({ jsx: true })];
  if (["ts", "tsx"].includes(ext)) return [javascript({ jsx: true, typescript: true })];
  if (ext === "py") return [python()];
  if (["html", "htm", "vue", "svelte"].includes(ext)) return [html()];
  if (["css", "scss", "less"].includes(ext)) return [css()];
  if (ext === "json") return [json()];
  if (["md", "mdx", "markdown"].includes(ext)) return [markdown()];
  return [];
}

export default function CodeEditor({ value, onChange, file, readOnly, height = "100%", onSave }) {
  const saveKey = EditorView.domEventHandlers({
    keydown(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        onSave?.();
        return true;
      }
      return false;
    },
  });
  return (
    <CodeMirror
      value={value}
      height={height}
      theme={fishTheme}
      readOnly={readOnly}
      extensions={[...languageFor(file), syntaxHighlighting(fishHighlight), EditorView.lineWrapping, saveKey]}
      onChange={onChange}
      basicSetup={{ highlightActiveLine: true, foldGutter: true, autocompletion: true, bracketMatching: true }}
    />
  );
}
