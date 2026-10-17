import { useEffect, useMemo, useRef, useState } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { HighlightStyle, syntaxHighlighting, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
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
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.035)" },
    ".cm-cursor": { borderLeftColor: "var(--accent)", borderLeftWidth: "2px" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection": { backgroundColor: "rgba(255,255,255,0.14) !important" },
    ".cm-matchingBracket": { backgroundColor: "rgba(255,255,255,0.12)", outline: "none" },
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

/** Human name of the language for the status bar. */
export function languageName(file = "") {
  const desc = LanguageDescription.matchFilename(languages, file.split(/[\\/]/).pop() || "");
  return desc?.name || "Plain Text";
}

export default function CodeEditor({ value, onChange, file, readOnly, height = "100%", onSave, onCreate, onCursor, keys = [], wrap = true, goto, extra }) {
  const [lang, setLang] = useState(() => languageFor(file));
  const view = useRef(null);
  const cb = useRef({});
  cb.current = { onSave, onCursor, keys };

  // Load a grammar for any language CodeMirror knows (Rust, Go, Java, C++, SQL, YAML…).
  useEffect(() => {
    let alive = true;
    const quick = languageFor(file);
    setLang(quick);
    const desc = LanguageDescription.matchFilename(languages, (file || "").split(/[\\/]/).pop() || "");
    if (desc && !quick.length) desc.load().then((support) => alive && setLang([support])).catch(() => {});
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => {
    const v = view.current;
    if (!v || !goto?.line) return;
    const line = v.state.doc.line(Math.min(Math.max(1, goto.line), v.state.doc.lines));
    const pos = Math.min(line.from + Math.max(0, (goto.col || 1) - 1), line.to);
    v.dispatch({ selection: { anchor: pos, head: pos + (goto.len || 0) }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    v.focus();
  }, [goto]);

  const extensions = useMemo(
    () => [
      ...lang,
      syntaxHighlighting(fishHighlight),
      ...(wrap ? [EditorView.lineWrapping] : []),
      ...(extra || []),
      Prec.highest(
        keymap.of([
          { key: "Mod-s", preventDefault: true, run: () => (cb.current.onSave?.(), true) },
          ...cb.current.keys.map((k) => ({ key: k.key, preventDefault: true, run: (v) => (cb.current.keys.find((x) => x.key === k.key)?.run(v), true) })),
        ]),
      ),
      EditorView.updateListener.of((u) => {
        if (!cb.current.onCursor || !(u.selectionSet || u.docChanged)) return;
        const sel = u.state.selection.main;
        const line = u.state.doc.lineAt(sel.head);
        cb.current.onCursor({ line: line.number, col: sel.head - line.from + 1, selected: sel.to - sel.from, lines: u.state.doc.lines });
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang, wrap, extra, keys.map((k) => k.key).join(",")],
  );

  return (
    <CodeMirror
      value={value}
      height={height}
      theme={fishTheme}
      readOnly={readOnly}
      extensions={extensions}
      onChange={onChange}
      onCreateEditor={(v) => {
        view.current = v;
        onCreate?.(v);
      }}
      basicSetup={{ highlightActiveLine: true, foldGutter: true, autocompletion: true, bracketMatching: true, highlightSelectionMatches: true }}
    />
  );
}
