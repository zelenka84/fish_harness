import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  XCircle, AlertTriangle, Files, Search, GitBranch, Bot, TerminalSquare, X, Save, ChevronRight, ArrowUp, ArrowDown, Sparkles, CornerDownLeft, GitCompareArrows, Plus,
} from "lucide-react";
import { useApp } from "../App.jsx";
import { api, basename, store } from "../api.js";
import { onFileChanged, send, pushDraft, useAgent, loadSession } from "../agentStore.js";
import CodeEditor, { languageName } from "../components/CodeEditor.jsx";
import Diff from "../components/Diff.jsx";
import ChatView, { useWorkspacePicker } from "./ChatView.jsx";
import { FishLogo } from "../components/ui.jsx";
import Explorer from "../ide/Explorer.jsx";
import SearchPanel from "../ide/SearchPanel.jsx";
import GitPanel from "../ide/GitPanel.jsx";
import TerminalPanel from "../ide/TerminalPanel.jsx";
import QuickOpen from "../ide/QuickOpen.jsx";
import { inlineCompletion } from "../ide/inlineCompletion.js";
import { fishLinter } from "../ide/diagnosticsLint.js";
import { nextDiagnostic } from "@codemirror/lint";
import ContextMenu from "../ide/ContextMenu.jsx";
import { FileIcon } from "../ide/icons.jsx";

const q = (ws) => `workspace=${encodeURIComponent(ws)}`;
const keyOf = (t) => `${t.kind}:${t.path}`;
const num = (k, d) => Number(store.get(k, d)) || d;

function Resizer({ dir = "x", onDrag, onEnd }) {
  const start = (e) => {
    e.preventDefault();
    let last = dir === "x" ? e.clientX : e.clientY;
    document.body.classList.add(dir === "x" ? "resizing-x" : "resizing-y");
    const move = (ev) => {
      const pos = dir === "x" ? ev.clientX : ev.clientY;
      onDrag(pos - last);
      last = pos;
    };
    const up = () => {
      document.body.classList.remove("resizing-x", "resizing-y");
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      onEnd?.();
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return <div className={`resizer resizer-${dir}`} onMouseDown={start} />;
}

export default function IdeView({ sessionId }) {
  const { state, config, updateConfig, toast, newSession, refreshSessions } = useApp();
  const ws = config.workspace;
  const agent = useAgent(sessionId);
  const { pick, modal } = useWorkspacePicker();
  const explorer = useRef(null);

  const [side, setSide] = useState(store.get("ide.side", "explorer"));
  const [sideW, setSideW] = useState(num("ide.sideW", 260));
  const [agentW, setAgentW] = useState(num("ide.agentW", 420));
  const [bottomH, setBottomH] = useState(num("ide.bottomH", 260));
  const [agentOpen, setAgentOpen] = useState(store.get("ide.agent", "1") === "1");
  const [termOpen, setTermOpen] = useState(store.get("ide.term", "0") === "1");
  const [termAdd, setTermAdd] = useState(0);
  const [tabs, setTabs] = useState([]);
  const [active, setActive] = useState(null);
  const [recent, setRecent] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [git, setGit] = useState(null);
  const [quickOpen, setQuickOpen] = useState(false);
  const [searchKey, setSearchKey] = useState(0);
  const [inline, setInline] = useState(null); // { path, from, to, text, value }
  const [tabMenu, setTabMenu] = useState(null);
  const [flash, setFlash] = useState("");
  const [problems, setProblems] = useState({ errors: 0, warnings: 0, checkers: [] });
  const [completing, setCompleting] = useState("idle");
  useEffect(() => {
    const on = (e) => setCompleting(e.detail);
    window.addEventListener("fish:complete", on);
    return () => window.removeEventListener("fish:complete", on);
  }, []);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const viewRef = useRef(null);

  const persist = (k, v) => store.set(k, String(v));
  const current = tabs.find((t) => keyOf(t) === active);

  /* -------------------------------- git -------------------------------- */
  const refreshGit = useCallback(() => api(`/git/status?${q(ws)}`).then(setGit).catch(() => setGit({ repo: false })), [ws]);
  useEffect(() => {
    refreshGit();
    const t = setInterval(() => document.visibilityState === "visible" && refreshGit(), 8000);
    return () => clearInterval(t);
  }, [refreshGit]);
  const gitMap = useMemo(() => {
    const m = new Map();
    for (const f of [...(git?.staged || []), ...(git?.unstaged || [])]) m.set(f.path, f.status === "?" ? "U" : f.status);
    return m;
  }, [git]);

  /* ------------------------------- tabs ------------------------------- */
  useEffect(() => {
    setTabs([]);
    setActive(null);
  }, [ws]);

  const openFile = useCallback(
    async (path, line, col, len) => {
      const goto = line ? { line, col, len, n: Date.now() } : undefined;
      const existing = tabsRef.current.find((t) => t.kind === "file" && t.path === path);
      if (existing) {
        if (goto) setTabs((ts) => ts.map((t) => (t === existing ? { ...t, goto } : t)));
      } else {
        try {
          const f = await api(`/fs/file?${q(ws)}&path=${encodeURIComponent(path)}`);
          setTabs((ts) => [...ts, { kind: "file", path, content: f.content, saved: f.content, goto }]);
        } catch (e) {
          return toast(e.message, "error");
        }
      }
      setActive(`file:${path}`);
      setRecent((r) => [path, ...r.filter((x) => x !== path)].slice(0, 20));
    },
    [ws, toast],
  );

  const openDiff = async (path) => {
    try {
      const d = await api(`/git/diff?${q(ws)}&path=${encodeURIComponent(path)}`);
      setTabs((ts) => [...ts.filter((t) => !(t.kind === "diff" && t.path === path)), { kind: "diff", path, head: d.head, work: d.work }]);
      setActive(`diff:${path}`);
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const save = async (path) => {
    const tab = tabsRef.current.find((t) => t.kind === "file" && t.path === path);
    if (!tab || tab.content === tab.saved) return;
    try {
      await api(`/fs/file?${q(ws)}&path=${encodeURIComponent(path)}`, { method: "PUT", body: { content: tab.content } });
      setTabs((ts) => ts.map((t) => (t.kind === "file" && t.path === path ? { ...t, saved: t.content } : t)));
      refreshGit();
    } catch (e) {
      toast(e.message, "error");
    }
  };

  const close = (key, force) => {
    const tab = tabsRef.current.find((t) => keyOf(t) === key);
    if (!tab) return;
    if (!force && tab.kind === "file" && tab.content !== tab.saved && !confirm(`Discard unsaved changes to ${basename(tab.path)}?`)) return;
    const idx = tabsRef.current.indexOf(tab);
    const next = tabsRef.current.filter((t) => t !== tab);
    setTabs(next);
    if (active === key) setActive(next[Math.min(idx, next.length - 1)] ? keyOf(next[Math.min(idx, next.length - 1)]) : null);
  };

  // Keep tabs in sync with the agent's edits and with explorer renames/deletes.
  useEffect(
    () =>
      onFileChanged(async (abs) => {
        const norm = abs.replace(/\\/g, "/");
        const root = ws.replace(/\\/g, "/").replace(/\/$/, "");
        if (!norm.toLowerCase().startsWith(root.toLowerCase())) return;
        const rel = norm.slice(root.length + 1);
        setFlash(`Fish edited ${rel}`);
        setTimeout(() => setFlash(""), 4000);
        explorer.current?.reload(rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "");
        refreshGit();
        const open = tabsRef.current.find((t) => t.kind === "file" && t.path === rel);
        if (open && open.content === open.saved) {
          const f = await api(`/fs/file?${q(ws)}&path=${encodeURIComponent(rel)}`);
          setTabs((ts) => ts.map((t) => (t.kind === "file" && t.path === rel ? { ...t, content: f.content, saved: f.content } : t)));
        }
      }),
    [ws, refreshGit],
  );
  const onRenamed = (from, to) =>
    setTabs((ts) =>
      ts.map((t) => {
        if (t.path === from || t.path.startsWith(from + "/")) {
          const path = to + t.path.slice(from.length);
          if (active === keyOf(t)) setActive(`${t.kind}:${path}`);
          return { ...t, path };
        }
        return t;
      }),
    );
  const onDeleted = (path) => tabsRef.current.filter((t) => t.path === path || t.path.startsWith(path + "/")).forEach((t) => close(keyOf(t), true));

  /* ------------------------------ agent ------------------------------- */
  const showAgent = () => {
    setAgentOpen(true);
    persist("ide.agent", 1);
  };
  const askAgent = async (text) => {
    showAgent();
    let id = sessionId;
    if (!id) id = (await newSession()).id;
    else await loadSession(id);
    send(id, text, { onTitle: refreshSessions, onDone: refreshSessions });
  };
  const selectionInfo = () => {
    const v = viewRef.current;
    if (!v || current?.kind !== "file") return null;
    const sel = v.state.selection.main;
    const from = v.state.doc.lineAt(sel.from).number;
    const to = v.state.doc.lineAt(sel.to).number;
    return { from, to, text: v.state.sliceDoc(sel.from, sel.to), empty: sel.empty };
  };
  const fixWithFish = async (path, d) => {
    await save(path);
    const where = `line ${d.line}:${d.col}`;
    const src = d.source ? ` [${d.source}]` : "";
    askAgent(`Fix this ${d.severity} in \`${path}\` at ${where}: ${d.message}${src}\n\nEdit the file directly with the Edit tool, then make sure the error is gone.`);
  };

  // Ghost-text completions + diagnostics for the open file.
  const currentPath = current?.kind === "file" ? current.path : null;
  const editorExtras = useMemo(() => {
    if (!currentPath) return [];
    const ext = [
      fishLinter({
        ws,
        path: currentPath,
        onResult: (list, checkers) =>
          setProblems({ errors: list.filter((d) => d.severity === "error").length, warnings: list.filter((d) => d.severity !== "error").length, checkers }),
        onFix: (d) => fixWithFish(currentPath, d),
      }),
    ];
    if (config.completionEnabled !== false) {
      ext.push(
        inlineCompletion(async (req, signal) => {
          const r = await api("/complete", { method: "POST", body: { path: currentPath, ...req }, signal });
          return r.text || "";
        }),
      );
    }
    return ext;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, ws, config.completionEnabled]);

  const fence = (path, text) => `\`\`\`${(languageName(path) || "").toLowerCase().replace(/\s+/g, "")}\n${text}\n\`\`\``;

  const addSelectionToChat = () => {
    const s = selectionInfo();
    if (!s) return;
    showAgent();
    const ref = s.empty ? `\`${current.path}\` (line ${s.from})` : `\`${current.path}\` lines ${s.from}–${s.to}:\n${fence(current.path, s.text)}`;
    setTimeout(() => pushDraft(ref), 60);
  };
  const openInline = () => {
    const s = selectionInfo();
    if (!s) return;
    setInline({ path: current.path, ...s, value: "" });
  };
  const submitInline = async () => {
    const it = inline;
    if (!it?.value.trim()) return;
    setInline(null);
    await save(it.path); // the agent reads from disk
    const where = it.empty ? `at line ${it.from}` : `lines ${it.from}–${it.to}`;
    const body = it.empty ? "" : `\n${fence(it.path, it.text)}\n`;
    askAgent(`In \`${it.path}\`, ${where}:${body}\nInstruction: ${it.value.trim()}\n\nEdit the file directly with the Edit tool and keep the rest of the file unchanged.`);
  };

  /* ---------------------------- shortcuts ---------------------------- */
  useEffect(() => {
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const handle = (fn) => {
        e.preventDefault();
        fn();
      };
      if (k === "p" && !e.shiftKey) handle(() => setQuickOpen(true));
      else if (e.shiftKey && k === "f") handle(() => (setSide("search"), persist("ide.side", "search"), setSearchKey((n) => n + 1)));
      else if (e.shiftKey && k === "e") handle(() => (setSide("explorer"), persist("ide.side", "explorer")));
      else if (e.shiftKey && k === "g") handle(() => (setSide("git"), persist("ide.side", "git"), refreshGit()));
      else if (e.code === "Backquote" && e.shiftKey) handle(() => (setTermOpen(true), persist("ide.term", 1), setTermAdd((n) => n + 1)));
      else if (e.code === "Backquote") handle(() => setTermOpen((o) => (persist("ide.term", o ? 0 : 1), !o)));
      else if (k === "b" && !e.shiftKey) handle(() => setSide((s) => (s ? (persist("ide.side", ""), null) : (persist("ide.side", "explorer"), "explorer"))));
      else if (k === "i" && !e.shiftKey) handle(() => setAgentOpen((o) => (persist("ide.agent", o ? 0 : 1), !o)));
      else if (k === "w" && active) handle(() => close(active));
      else if (e.key === "Tab" && tabsRef.current.length > 1) {
        handle(() => {
          const i = tabsRef.current.findIndex((t) => keyOf(t) === active);
          const n = tabsRef.current.length;
          setActive(keyOf(tabsRef.current[(i + (e.shiftKey ? -1 : 1) + n) % n]));
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, refreshGit]);

  /* ------------------------------ layout ------------------------------ */
  const activity = [
    { id: "explorer", icon: Files, label: "Explorer (Ctrl+Shift+E)" },
    { id: "search", icon: Search, label: "Search (Ctrl+Shift+F)" },
    { id: "git", icon: GitBranch, label: "Source control (Ctrl+Shift+G)", badge: (git?.staged?.length || 0) + (git?.unstaged?.length || 0) },
  ];
  const lineEnding = current?.kind === "file" && current.content.includes("\r\n") ? "CRLF" : "LF";
  const dirty = tabs.filter((t) => t.kind === "file" && t.content !== t.saved).length;

  return (
    <div className="ide2" style={{ gridTemplateColumns: `44px ${side ? `min(${sideW}px, 28vw)` : "0px"} minmax(0, 1fr) ${agentOpen ? `min(${agentW}px, 38vw)` : "0px"}` }}>
      <nav className="activity">
        {activity.map((a) => (
          <button
            key={a.id}
            className={`act-btn ${side === a.id ? "on" : ""}`}
            title={a.label}
            onClick={() => setSide((s) => (s === a.id ? (persist("ide.side", ""), null) : (persist("ide.side", a.id), a.id)))}
          >
            <a.icon size={19} strokeWidth={1.7} />
            {a.badge > 0 && <span className="act-badge">{a.badge > 99 ? "99+" : a.badge}</span>}
          </button>
        ))}
        <span className="grow" />
        <button className={`act-btn ${termOpen ? "on" : ""}`} title="Terminal (Ctrl+`)" onClick={() => setTermOpen((o) => (persist("ide.term", o ? 0 : 1), !o))}><TerminalSquare size={19} strokeWidth={1.7} /></button>
        <button className={`act-btn ${agentOpen ? "on" : ""}`} title="Agent (Ctrl+I)" onClick={() => setAgentOpen((o) => (persist("ide.agent", o ? 0 : 1), !o))}><Bot size={19} strokeWidth={1.7} /></button>
      </nav>

      <aside className="side-wrap">
        {side === "explorer" && (
          <Explorer
            ref={explorer}
            ws={ws}
            active={current?.path}
            git={gitMap}
            onOpen={(p) => openFile(p)}
            onPick={async () => { const d = await pick(ws); if (d) updateConfig({ workspace: d }); }}
            onRenamed={onRenamed}
            onDeleted={onDeleted}
            onAddToChat={(p) => { showAgent(); setTimeout(() => pushDraft(`\`${p}\``), 60); }}
          />
        )}
        {side === "search" && <SearchPanel ws={ws} focusKey={searchKey} onOpenAt={(p, line, col, len) => openFile(p, line, col, len)} />}
        {side === "git" && <GitPanel ws={ws} git={git} refresh={refreshGit} onOpenDiff={openDiff} onAskAgent={askAgent} />}
        {side && <Resizer onDrag={(dx) => setSideW((w) => Math.min(600, Math.max(170, w + dx)))} onEnd={() => persist("ide.sideW", sideW)} />}
      </aside>

      <section className="center-col" style={{ gridTemplateRows: `36px minmax(0, 1fr) ${termOpen ? `${bottomH}px` : "0px"} 24px` }}>
        <div className="tabs">
          {tabs.map((t) => {
            const k = keyOf(t);
            const isDirty = t.kind === "file" && t.content !== t.saved;
            return (
              <button
                key={k}
                className={`tab ${k === active ? "active" : ""}`}
                onClick={() => setActive(k)}
                onMouseDown={(e) => e.button === 1 && (e.preventDefault(), close(k))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setTabMenu({
                    x: e.clientX, y: e.clientY,
                    items: [
                      { label: "Close", hint: "Ctrl+W", run: () => close(k) },
                      { label: "Close others", run: () => tabsRef.current.filter((x) => keyOf(x) !== k).forEach((x) => close(keyOf(x))) },
                      { label: "Close all", run: () => tabsRef.current.forEach((x) => close(keyOf(x))) },
                      { sep: true },
                      { label: "Copy relative path", run: () => navigator.clipboard?.writeText(t.path) },
                      { label: "Reveal in explorer", run: () => (setSide("explorer"), setTimeout(() => explorer.current?.reveal(t.path), 50)) },
                      ...(t.kind === "file" && gitMap.has(t.path) ? [{ label: "Open changes", run: () => openDiff(t.path) }] : []),
                    ],
                  });
                }}
                title={t.path}
              >
                {t.kind === "diff" ? <GitCompareArrows size={13} /> : <FileIcon name={t.path} size={14} />}
                <span className={gitMap.has(t.path) ? `git-${gitMap.get(t.path)}` : ""}>{basename(t.path)}{t.kind === "diff" && " (changes)"}</span>
                {isDirty ? (
                  <span className="dirty-dot" onClick={(e) => (e.stopPropagation(), close(k))} />
                ) : (
                  <span className="x icon-btn sm" onClick={(e) => (e.stopPropagation(), close(k))}><X size={12} /></span>
                )}
              </button>
            );
          })}
          <span className="grow" />
        </div>

        <div className="editor">
          {current?.kind === "file" && (
            <>
              <div className="breadcrumbs">
                {current.path.split("/").map((seg, i, arr) => (
                  <span key={i} className="crumb">
                    {i > 0 && <ChevronRight size={12} />}
                    {i === arr.length - 1 && <FileIcon name={seg} size={13} />}
                    {seg}
                  </span>
                ))}
                <span className="grow" />
                <span className="crumb-hint"><kbd>Ctrl K</kbd> edit with AI · <kbd>Ctrl L</kbd> add to chat</span>
              </div>
              <div className="editor-area">
                <CodeEditor
                  key={current.path}
                  file={current.path}
                  value={current.content}
                  wrap={false}
                  extra={editorExtras}
                  goto={current.goto}
                  onCreate={(v) => (viewRef.current = v)}
                  onCursor={setCursor}
                  onChange={(v) => setTabs((ts) => ts.map((t) => (t.kind === "file" && t.path === current.path ? { ...t, content: v } : t)))}
                  onSave={() => save(current.path)}
                  keys={[
                    { key: "Mod-k", run: openInline },
                    { key: "Mod-l", run: addSelectionToChat },
                  ]}
                />
                {inline && (
                  <div className="inline-ask">
                    <Sparkles size={15} style={{ color: "var(--text-2)", flex: "none" }} />
                    <input
                      autoFocus
                      placeholder={inline.empty ? `Ask Fish to change ${basename(inline.path)} at line ${inline.from}…` : `Edit lines ${inline.from}–${inline.to} — describe the change…`}
                      value={inline.value}
                      onChange={(e) => setInline((x) => ({ ...x, value: e.target.value }))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitInline();
                        if (e.key === "Escape") (setInline(null), viewRef.current?.focus());
                      }}
                    />
                    <button className="btn xs primary" onClick={submitInline}><CornerDownLeft size={12} /></button>
                    <button className="icon-btn sm" onClick={() => setInline(null)}><X size={13} /></button>
                  </div>
                )}
              </div>
            </>
          )}
          {current?.kind === "diff" && (
            <div className="diff-tab">
              <div className="breadcrumbs">
                <GitCompareArrows size={13} /> {current.path} <span className="muted">— HEAD ↔ working tree</span>
                <span className="grow" />
                <button className="btn xs" onClick={() => openFile(current.path)}>Open file</button>
              </div>
              <div style={{ overflow: "auto", flex: 1 }}>
                {current.head === current.work ? <div className="muted small" style={{ padding: 20 }}>No changes.</div> : <Diff before={current.head} after={current.work} context={4} />}
              </div>
            </div>
          )}
          {!current && (
            <div className="welcome" style={{ height: "100%" }}>
              <FishLogo size={56} id="ide" />
              <h2 style={{ fontSize: 22 }}>{basename(ws)}</h2>
              <div className="shortcut-grid">
                {[
                  ["Ctrl P", "Go to file"], ["Ctrl Shift F", "Search in files"], ["Ctrl `", "Terminal"], ["Ctrl K", "Edit with AI"],
                  ["Ctrl L", "Add to chat"], ["Ctrl I", "Toggle agent"], ["Ctrl B", "Toggle sidebar"], ["Ctrl Shift G", "Source control"],
                ].map(([k, l]) => (
                  <div key={k} className="row" style={{ justifyContent: "space-between" }}><span className="muted">{l}</span><kbd>{k}</kbd></div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="bottom-wrap">
          {termOpen && (
            <>
              <Resizer dir="y" onDrag={(dy) => setBottomH((h) => Math.min(700, Math.max(120, h - dy)))} onEnd={() => persist("ide.bottomH", bottomH)} />
              <TerminalPanel cwd={ws} shell={state.platform === "win32" ? "pwsh" : "bash"} addKey={termAdd} onHide={() => (setTermOpen(false), persist("ide.term", 0))} />
            </>
          )}
        </div>

        <div className="statusbar">
          {git?.repo && (
            <button className="sb-item" onClick={() => setSide("git")}>
              <GitBranch size={12} /> {git.branch}
              {git.ahead > 0 && <><ArrowUp size={11} />{git.ahead}</>}
              {git.behind > 0 && <><ArrowDown size={11} />{git.behind}</>}
            </button>
          )}
          {dirty > 0 && <span className="sb-item">● {dirty} unsaved</span>}
          {agent?.running && <span className="sb-item"><span className="live-dot" /> Fish is working…</span>}
          {flash && <span className="sb-item flash">{flash}</span>}
          <span className="grow" />
          {current?.kind === "file" && (
            <>
              {cursor && <span className="sb-item">Ln {cursor.line}, Col {cursor.col}{cursor.selected ? ` (${cursor.selected} selected)` : ""}</span>}
              <button
                className={`sb-item ${problems.errors ? "sb-err" : problems.warnings ? "sb-warn" : ""}`}
                title={problems.checkers.length ? `Checked by ${problems.checkers.join(", ")} — click for the next problem` : "No checker for this file type"}
                onClick={() => viewRef.current && nextDiagnostic(viewRef.current)}
              >
                <XCircle size={11} /> {problems.errors} <AlertTriangle size={11} /> {problems.warnings}
              </button>
              <button
                className={`sb-item complete-${completing}`}
                title={config.completionEnabled !== false ? "Tab autocomplete is on — click to turn off" : "Tab autocomplete is off — click to turn on"}
                onClick={() => updateConfig({ completionEnabled: config.completionEnabled === false })}
              >
                <Sparkles size={11} /> {config.completionEnabled !== false ? (completing === "loading" ? "…" : "Tab") : "off"}
              </button>
              <span className="sb-item">Spaces: 2</span>
              <span className="sb-item">UTF-8</span>
              <span className="sb-item">{lineEnding}</span>
              <span className="sb-item">{languageName(current.path)}</span>
              {current.content !== current.saved && <button className="sb-item" onClick={() => save(current.path)}><Save size={11} /> Save</button>}
            </>
          )}
        </div>
      </section>

      <section className="agent-panel">
        {agentOpen && (
          <>
            <Resizer onDrag={(dx) => setAgentW((w) => Math.min(800, Math.max(300, w - dx)))} onEnd={() => persist("ide.agentW", agentW)} />
            <div className="panel-head">
              <Bot size={14} /> <span className="grow">Agent</span>
              <button className="icon-btn sm" title="New session" onClick={() => newSession()}><Plus size={14} /></button>
              <button className="icon-btn sm" title="Hide (Ctrl+I)" onClick={() => (setAgentOpen(false), persist("ide.agent", 0))}><X size={14} /></button>
            </div>
            <ChatView sessionId={sessionId} compact />
          </>
        )}
      </section>

      {quickOpen && <QuickOpen ws={ws} recent={recent} onOpen={(p, line) => openFile(p, line)} onClose={() => setQuickOpen(false)} />}
      {tabMenu && <ContextMenu {...tabMenu} onClose={() => setTabMenu(null)} />}
      {modal}
    </div>
  );
}
