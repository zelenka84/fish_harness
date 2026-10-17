// Cursor-style ghost-text completions for CodeMirror: debounce → fetch → show → Tab accepts.
import { StateField, StateEffect, Prec } from "@codemirror/state";
import { EditorView, Decoration, WidgetType, keymap, ViewPlugin } from "@codemirror/view";

const setSuggestion = StateEffect.define();

class Ghost extends WidgetType {
  constructor(text) {
    super();
    this.text = text;
  }
  eq(other) {
    return other.text === this.text;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-ghost";
    el.textContent = this.text;
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

const suggestionField = StateField.define({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setSuggestion)) return e.value;
    if (tr.docChanged || tr.selection) return null;
    return value;
  },
  provide: (f) =>
    EditorView.decorations.from(f, (v) => (v ? Decoration.set([Decoration.widget({ widget: new Ghost(v.text), side: 1 }).range(v.pos)]) : Decoration.none)),
});

const status = (state) => window.dispatchEvent(new CustomEvent("fish:complete", { detail: state }));

/** Only suggest when the cursor sits at the end of the line (ignoring closing brackets). */
function goodSpot(state) {
  const sel = state.selection.main;
  if (!sel.empty) return false;
  const line = state.doc.lineAt(sel.head);
  const after = line.text.slice(sel.head - line.from);
  const before = line.text.slice(0, sel.head - line.from);
  if (!/^[\s)\]}'"`;,]*$/.test(after)) return false;
  return before.trim().length > 0 || line.number > 1;
}

/**
 * @param {(req: {prefix: string, suffix: string}, signal: AbortSignal) => Promise<string>} fetchCompletion
 */
export function inlineCompletion(fetchCompletion, { delay = 450 } = {}) {
  const plugin = ViewPlugin.fromClass(
    class {
      constructor(view) {
        this.view = view;
        this.timer = null;
        this.ctrl = null;
      }
      update(u) {
        if (!u.docChanged) {
          if (u.selectionSet) this.cancel();
          return;
        }
        if (u.transactions.some((t) => t.effects.some((e) => e.is(setSuggestion)))) return;
        // Don't ask again right after a suggestion was accepted.
        if (u.transactions.some((t) => t.isUserEvent("input.complete"))) return this.cancel();
        this.cancel();
        if (!goodSpot(u.state)) return;
        this.timer = setTimeout(() => this.request(), delay);
      }
      cancel() {
        clearTimeout(this.timer);
        this.ctrl?.abort();
        this.ctrl = null;
      }
      async request() {
        const { state } = this.view;
        const pos = state.selection.main.head;
        const doc = state.doc;
        const ctrl = new AbortController();
        this.ctrl = ctrl;
        status("loading");
        try {
          const text = await fetchCompletion({ prefix: doc.sliceString(0, pos), suffix: doc.sliceString(pos) }, ctrl.signal);
          const now = this.view.state;
          if (ctrl.signal.aborted || now.doc !== doc || now.selection.main.head !== pos || !text?.trim()) return status("idle");
          this.view.dispatch({ effects: setSuggestion.of({ pos, text }) });
          status("ready");
        } catch {
          status(ctrl.signal.aborted ? "idle" : "error");
        }
      }
      destroy() {
        this.cancel();
      }
    },
  );

  const accept = (view) => {
    const s = view.state.field(suggestionField, false);
    if (!s) return false;
    view.dispatch({ changes: { from: s.pos, insert: s.text }, selection: { anchor: s.pos + s.text.length }, userEvent: "input.complete" });
    status("idle");
    return true;
  };
  // Accept just the next word of the suggestion (Ctrl+→), like Cursor.
  const acceptWord = (view) => {
    const s = view.state.field(suggestionField, false);
    if (!s) return false;
    const m = /^\s*[\w$]+|^\s*[^\w\s]+|^\s+/.exec(s.text);
    const part = m ? m[0] : s.text;
    const rest = s.text.slice(part.length);
    view.dispatch({
      changes: { from: s.pos, insert: part },
      selection: { anchor: s.pos + part.length },
      effects: setSuggestion.of(rest ? { pos: s.pos + part.length, text: rest } : null),
    });
    return true;
  };
  const dismiss = (view) => {
    if (!view.state.field(suggestionField, false)) return false;
    view.dispatch({ effects: setSuggestion.of(null) });
    return true;
  };

  return [
    suggestionField,
    plugin,
    Prec.highest(
      keymap.of([
        { key: "Tab", run: accept },
        { key: "Mod-ArrowRight", run: acceptWord },
        { key: "Escape", run: dismiss },
      ]),
    ),
  ];
}
