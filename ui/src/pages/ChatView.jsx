import { useEffect, useMemo, useState } from "react";
import { PanelRight, ListTodo, GitCompareArrows, Gauge, Bug, Rocket, BookOpen, TestTube2, FileCode2, ChevronRight, FolderOpen } from "lucide-react";
import { useApp, SidebarToggle } from "../App.jsx";
import { useAgent, send, stop, patchLocalSession } from "../agentStore.js";
import { api, fmt, basename, store } from "../api.js";
import Transcript, { TodoList } from "../components/Transcript.jsx";
import Composer from "../components/Composer.jsx";
import Diff, { DiffStats } from "../components/Diff.jsx";
import { FishLogo, Modal } from "../components/ui.jsx";

const SUGGESTIONS = [
  { icon: BookOpen, title: "Explain this codebase", text: "Give me a guided tour of this codebase: architecture, key modules and how data flows through it." },
  { icon: Bug, title: "Find and fix a bug", text: "Look for likely bugs in this project, rank them by severity, then fix the most important one." },
  { icon: TestTube2, title: "Write tests", text: "Use the write-tests skill: add focused tests for the most critical untested module." },
  { icon: Rocket, title: "Build a feature", text: "Help me plan and build a new feature. Start by asking what I want, then propose a plan." },
];

export function useWorkspacePicker() {
  const { config, toast } = useApp();
  const [open, setOpen] = useState(false);
  const pick = async (current) => {
    if (window.fish?.pickFolder) {
      const dir = await window.fish.pickFolder(current || config.workspace);
      return dir || null;
    }
    return new Promise((resolve) => setOpen({ resolve, value: current || config.workspace }));
  };
  const modal = open ? (
    <WorkspaceModal
      initial={open.value}
      onClose={() => (open.resolve(null), setOpen(false))}
      onPick={async (dir) => {
        const { exists } = await api(`/fs/exists?path=${encodeURIComponent(dir)}`);
        if (!exists) return toast("Folder does not exist", "error");
        open.resolve(dir);
        setOpen(false);
      }}
    />
  ) : null;
  return { pick, modal };
}

function WorkspaceModal({ initial, onClose, onPick }) {
  const [value, setValue] = useState(initial);
  return (
    <Modal
      title="Choose workspace folder"
      icon={<FolderOpen size={20} style={{ color: "var(--accent)" }} />}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onPick(value.trim())}>Open folder</button></>}
    >
      <label className="field">
        Absolute path
        <input className="input mono" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && onPick(value.trim())} />
        <span className="hint">Fish reads, edits and runs commands inside this folder.</span>
      </label>
    </Modal>
  );
}

export default function ChatView({ sessionId, compact, sidebarOpen, onToggleSidebar }) {
  const { config, newSession, refreshSessions, updateConfig, account } = useApp();
  const entry = useAgent(sessionId);
  const [panel, setPanel] = useState(store.get("fish.panel", "1") === "1");
  const [draftModel, setDraftModel] = useState(config.model);
  const { pick, modal } = useWorkspacePicker();

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && entry?.running && stop(sessionId);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [entry?.running, sessionId]);

  const doSend = async (text, id = sessionId) => {
    send(id, text, { onTitle: refreshSessions, onDone: refreshSessions });
  };

  const startWith = async (text) => {
    const s = await newSession({ model: draftModel, workspace: config.workspace });
    doSend(text, s.id);
  };

  const changeWorkspace = async () => {
    const dir = await pick(entry?.session.workspace);
    if (!dir) return;
    if (entry) {
      await api(`/sessions/${sessionId}`, { method: "PATCH", body: { workspace: dir } });
      patchLocalSession(sessionId, { workspace: dir });
    }
    await updateConfig({ workspace: dir });
    refreshSessions();
  };

  const setModel = async (model) => {
    if (!entry) return setDraftModel(model);
    await api(`/sessions/${sessionId}`, { method: "PATCH", body: { model } });
    patchLocalSession(sessionId, { model });
  };

  if (!sessionId || !entry) {
    const hour = new Date().getHours();
    const greet = hour < 5 ? "Night owl mode" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    return (
      <div className={`chat-col ${compact ? "compact" : ""}`} style={{ flex: 1 }}>
        {!compact && (
          <div className="chat-head" style={{ borderColor: "transparent" }}>
            <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />
          </div>
        )}
        <div className="welcome">
          <div className="hero-logo">
            <FishLogo size={compact ? 56 : 84} id="hero" />
            <div className="bubbles">
              <span style={{ left: "70%", animationDelay: "0s" }} />
              <span style={{ left: "78%", animationDelay: "1.2s", width: 4, height: 4 }} />
              <span style={{ left: "64%", animationDelay: "2.3s", width: 5, height: 5 }} />
            </div>
          </div>
          <h2 style={compact ? { fontSize: 22 } : undefined}>
            {greet}, <span className="grad-text">{account?.name || "friend"}</span>
          </h2>
          <p>What are we building in <b style={{ color: "var(--text-2)" }}>{basename(config.workspace)}</b> today?</p>
          {!compact && (
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s.title} className="suggestion" onClick={() => startWith(s.text)}>
                  <s.icon size={17} />
                  <span>
                    <b>{s.title}</b>
                    {s.text.slice(0, 64)}…
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <Composer onSend={startWith} model={draftModel} onModel={setModel} workspace={config.workspace} onWorkspace={changeWorkspace} compact={compact} />
        {modal}
      </div>
    );
  }

  const { session, running } = entry;

  return (
    <div className={`chat ${compact ? "compact" : ""}`}>
      <div className={`chat-col ${compact ? "compact" : ""}`}>
        <div className="chat-head">
          {!compact && <SidebarToggle open={sidebarOpen} onToggle={onToggleSidebar} />}
          <TitleEditor session={session} onSaved={refreshSessions} />
          {!compact && (
            <>
              <span className="badge" title={session.workspace}><FolderOpen size={11} /> {basename(session.workspace)}</span>
              <span className="badge violet">{fmt.cost(session.usage?.cost)}</span>
              <button className="icon-btn" onClick={() => setPanel((p) => (store.set("fish.panel", p ? "0" : "1"), !p))} title="Toggle panel">
                <PanelRight size={17} />
              </button>
            </>
          )}
        </div>
        <Transcript entry={entry} compact={compact} />
        <Composer
          onSend={(t) => doSend(t)}
          running={running}
          onStop={() => stop(sessionId)}
          model={session.model || config.model}
          onModel={setModel}
          workspace={session.workspace}
          onWorkspace={changeWorkspace}
          compact={compact}
        />
      </div>
      {!compact && <SidePanel session={session} hidden={!panel} />}
      {modal}
    </div>
  );
}

function TitleEditor({ session, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(session.title);
  useEffect(() => setValue(session.title), [session.title]);
  const save = async () => {
    setEditing(false);
    if (value.trim() && value !== session.title) {
      await api(`/sessions/${session.id}`, { method: "PATCH", body: { title: value.trim() } });
      patchLocalSession(session.id, { title: value.trim() });
      onSaved();
    }
  };
  return editing ? (
    <input className="title-input grow" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Enter" && save()} />
  ) : (
    <div className="title grow ellipsis" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
      {session.title}
    </div>
  );
}

function SidePanel({ session, hidden }) {
  const { state } = useApp();
  const [tab, setTab] = useState("tasks");
  const todos = session.todos || [];
  const changes = useMemo(() => {
    const byPath = new Map();
    for (const c of session.changes || []) {
      const prev = byPath.get(c.path);
      byPath.set(c.path, { path: c.path, before: prev ? prev.before : c.before, after: c.after, ts: c.ts });
    }
    return [...byPath.values()].reverse();
  }, [session.changes]);
  const model = state.models.find((m) => m.id === session.model);
  const ctx = session.lastContext || 0;
  const ctxMax = model?.ctx || 1_000_000;
  const u = session.usage || {};

  return (
    <aside className={`sidepanel ${hidden ? "hidden" : ""}`}>
      <div className="sp-tabs">
        <button className={tab === "tasks" ? "on" : ""} onClick={() => setTab("tasks")}>
          <ListTodo size={14} /> Tasks {todos.length > 0 && <span className="count">{todos.filter((t) => t.status === "completed").length}/{todos.length}</span>}
        </button>
        <button className={tab === "changes" ? "on" : ""} onClick={() => setTab("changes")}>
          <GitCompareArrows size={14} /> Changes {changes.length > 0 && <span className="count">{changes.length}</span>}
        </button>
        <button className={tab === "context" ? "on" : ""} onClick={() => setTab("context")}>
          <Gauge size={14} /> Usage
        </button>
      </div>
      <div className="sp-body">
        {tab === "tasks" &&
          (todos.length ? (
            <TodoList todos={todos} plain />
          ) : (
            <div className="empty"><ListTodo size={22} />No task list yet.<span className="small">Fish creates one for multi-step work.</span></div>
          ))}
        {tab === "changes" &&
          (changes.length ? changes.map((c) => <ChangeItem key={c.path} change={c} root={session.workspace} />) : (
            <div className="empty"><FileCode2 size={22} />No file changes in this session.</div>
          ))}
        {tab === "context" && (
          <div className="col" style={{ gap: 16 }}>
            <div className="card pad" style={{ padding: 16 }}>
              <div className="row small" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                <span className="muted">Context window</span>
                <span className="mono">{fmt.tokens(ctx)} / {fmt.tokens(ctxMax)}</span>
              </div>
              <div className="meter"><div style={{ width: `${Math.max(1, (ctx / ctxMax) * 100)}%` }} /></div>
            </div>
            <div>
              <div className="kv"><span>Model</span><span>{model?.label || session.model}</span></div>
              <div className="kv"><span>Input tokens</span><span className="mono">{fmt.tokens(u.input)}</span></div>
              <div className="kv"><span>Cache reads</span><span className="mono">{fmt.tokens(u.cacheRead)}</span></div>
              <div className="kv"><span>Cache writes</span><span className="mono">{fmt.tokens(u.cacheWrite)}</span></div>
              <div className="kv"><span>Output tokens</span><span className="mono">{fmt.tokens(u.output)}</span></div>
              <div className="kv"><span>Session cost</span><span className="mono grad-text" style={{ fontWeight: 700 }}>{fmt.cost(u.cost)}</span></div>
              <div className="kv"><span>Created</span><span>{new Date(session.createdAt).toLocaleString()}</span></div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function ChangeItem({ change, root }) {
  const [open, setOpen] = useState(false);
  const rel = change.path.startsWith(root) ? change.path.slice(root.length + 1) : change.path;
  return (
    <div className="change-item">
      <button className="head" onClick={() => setOpen((o) => !o)}>
        <ChevronRight size={14} style={{ transform: open ? "rotate(90deg)" : "", transition: "transform .15s", flex: "none" }} />
        <span className="grow ellipsis mono" style={{ fontSize: 12 }} title={change.path}>{rel}</span>
        {change.before === null && <span className="badge good">new</span>}
        <DiffStats before={change.before || ""} after={change.after} />
      </button>
      {open && <div style={{ borderTop: "1px solid var(--border)" }}><Diff before={change.before} after={change.after} /></div>}
    </div>
  );
}
