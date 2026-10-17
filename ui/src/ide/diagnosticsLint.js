// Server-side diagnostics (node --check, TypeScript, ESLint, Python, JSON) as a CodeMirror linter.
import { linter, lintGutter } from "@codemirror/lint";
import { api } from "../api.js";

export function fishLinter({ ws, path, onResult, onFix }) {
  return [
    lintGutter(),
    linter(
      async (view) => {
        const doc = view.state.doc;
        let res;
        try {
          res = await api("/diagnostics", { method: "POST", body: { workspace: ws, path, content: doc.toString() } });
        } catch {
          onResult?.([], []);
          return [];
        }
        const toPos = (line, col) => {
          const l = doc.line(Math.min(Math.max(1, line || 1), doc.lines));
          return Math.min(l.from + Math.max(0, (col || 1) - 1), l.to);
        };
        const out = res.diagnostics.map((d) => {
          let from = toPos(d.line, d.col);
          let to = d.endLine ? toPos(d.endLine, d.endCol) : from;
          if (to <= from) {
            // No range given: underline the word at the position, or the whole line.
            const line = doc.lineAt(from);
            const word = /^[\w$]+/.exec(doc.sliceString(from, line.to))?.[0].length || 1;
            to = Math.min(line.to, from + word);
            if (to <= from) [from, to] = [line.from, line.to];
          }
          return {
            from,
            to,
            severity: d.severity === "error" ? "error" : "warning",
            message: d.message,
            source: d.source,
            actions: [{ name: "Fix with Fish", apply: () => onFix?.(d) }],
          };
        });
        onResult?.(out, res.checkers || []);
        return out;
      },
      { delay: 900 },
    ),
  ];
}
