import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, Folder, FolderOpen, FileCode2, RefreshCw, X, GitBranch, PanelRightClose, PanelRightOpen, Save, FolderInput, Bot, Plus } from "lucide-react";
import { useApp } from "../App.jsx";
import { api, basename, store } from "../api.js";
import { onFileChanged } from "../agentStore.js";
import CodeEditor from "../components/CodeEditor.jsx";
import ChatView, { useWorkspacePicker } from "./ChatView.jsx";
import { FishLogo } from "../components/ui.jsx";

export default function IdeView({ sessionId }) {
  const { config, updateConfig, toast, newSession } = useApp();
  const ws = config.workspace;
  const [tree, setTree] = useState({}); // dir -> entries
  const [openDirs, setOpenDirs] = useState(() => new Set([""]));
  const [tabs, setTabs] = useState([]); // { path, content, saved, mtime }
  const [active, setActive] = useState(null);
  const [git, setGit] = useState(null);
  const [agentOpen, setAgentOpen] = useState(store.get("fish.ideAgent", "1") === "1");
  const [flash, setFlash] = useState("");
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const { pick, modal } = useWorkspacePicker();

  const loadDir = useCallback(
    async (dir) => {
      try {
        const entries = await api(`/fs/list?workspace=${encodeURIComponent(ws)}&path=${encodeURIComponent(dir)}`);
        setTree((t) => ({ ...t, [dir]: entries }));
      } catch (e) {
        toast(e.message, "error");
      }
    },
    [ws, toast],
  );
  const refreshGit = useCallback(() => api(`/git?workspace=${encodeURIComponent(ws)}`).then(setGit).catch(() => {}), [ws]);

  useEffect(() => {
    setTree({});
    setTabs([]);
    setActive(null);
    setOpenDirs(new Set([""]));
    loadDir("");
    refreshGit();
  }, [ws, loadDir, refreshGit]);

  const openFile = async (path) => {
    if (!tabsRef.current.find((t) => t.path === path)) {
      try {
        const f = await api(`/fs/file?workspace=${encodeURIComponent(ws)}&path=${encodeURIComponent(path)}`);
        setTabs((ts) => [...ts, { path, content: f.content, saved: f.content }]);
      } catch (e) {
        return toast(e.message, "error");
      }
    }
    setActive(path);
  };

  // Reload files the agent edits; refresh tree + git.
  useEffect(
    () =>
      onFileChanged(async (abs) => {
        const norm = abs.replace(/\\/g, "/");
        const root = ws.replace(/\\/g, "/").replace(/\/$/, "");
        const rel = norm.startsWith(root) ? norm.slice(root.length + 1) : null;
        if (!rel) return;
        setFlash(`Fish edited ${rel}`);
        setTimeout(() => setFlash(""), 3500);
        const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "";
        loadDir(dir);
        refreshGit();
        const open = tabsRef.current.find((t) => t.path === rel);
        if (open && open.content === open.saved) {
          const f = await api(`/fs/file?workspace=${encodeURIComponent(ws)}&path=${encodeURIComponent(rel)}`);
          setTabs((ts) => ts.map((t) => (t.path === rel ? { ...t, content: f.content, saved: f.content } : t)));
        }
      }),
    [ws, loadDir, refreshGit],
  );

  const save = async (path = active) => {
    const tab = tabsRef.current.find((t) => t.path === path);
    if (!tab) return;
    await api(`/fs/file?workspace=${encodeURIComponent(ws)}&path=${encodeURIComponent(path)}`, { method: "PUT", body: { content: tab.content } });
    setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, saved: t.content } : t)));
    refreshGit();
    toast(`Saved ${basename(path)}`);
  };

  const closeTab = (path, e) => {
    e?.stopPropagation();
    const tab = tabs.find((t) => t.path === path);
    if (tab && tab.content !== tab.saved && !confirm(`Discard unsaved changes to ${basename(path)}?`)) return;
    const next = tabs.filter((t) => t.path !== path);
    setTabs(next);
    if (active === path) setActive(next.at(-1)?.path || null);
  };

  const toggleDir = (dir) => {
    setOpenDirs((s) => {
      const n = new Set(s);
      if (n.has(dir)) n.delete(dir);
      else {
        n.add(dir);
        if (!tree[dir]) loadDir(dir);
      }
      return n;
    });
  };

  const gitStatus = new Map((git?.changes || []).map((c) => [c.path, c.status]));
  const current = tabs.find((t) => t.path === active);

  const renderDir = (dir, depth) =>
    (tree[dir] || []).map((e) => (
      <div key={e.path}>
        <button className={`tree-row ${active === e.path ? "active" : ""}`} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => (e.dir ? toggleDir(e.path) : openFile(e.path))}>
          {e.dir ? <ChevronRight size={14} className={`chev ${openDirs.has(e.path) ? "open" : ""}`} /> : <span className="chev" />}
          {e.dir ? (openDirs.has(e.path) ? <FolderOpen size={15} style={{ color: "var(--accent)" }} /> : <Folder size={15} style={{ color: "var(--accent)" }} />) : <FileCode2 size={15} style={{ color: "var(--text-3)" }} />}
          <span className="ellipsis">{e.name}</span>
          {gitStatus.get(e.path) && <span className="mod">{gitStatus.get(e.path)}</span>}
        </button>
        {e.dir && openDirs.has(e.path) && renderDir(e.path, depth + 1)}
      </div>
    ));

  return (
    <div className={`ide ${agentOpen ? "" : "no-agent"}`}>
      <aside className="explorer">
        <div className="panel-head">
          <span className="grow ellipsis" title={ws}>{basename(ws)}</span>
          <button className="icon-btn sm" title="Open folder" onClick={async () => { const d = await pick(ws); if (d) updateConfig({ workspace: d }); }}>
            <FolderInput size={14} />
          </button>
          <button className="icon-btn sm" title="Refresh" onClick={() => (setTree({}), [...openDirs].forEach(loadDir), refreshGit())}>
            <RefreshCw size={13} />
          </button>
        </div>
        <div className="tree">{renderDir("", 0)}</div>
      </aside>

      <section className="editor-col">
        <div className="tabs">
          {tabs.map((t) => (
            <button key={t.path} className={`tab ${t.path === active ? "active" : ""}`} onClick={() => setActive(t.path)} title={t.path}>
              <FileCode2 size={13} />
              {basename(t.path)}
              {t.content !== t.saved ? <span className="dirty" /> : <span className="x icon-btn sm" onClick={(e) => closeTab(t.path, e)}><X size={12} /></span>}
            </button>
          ))}
          <div className="grow" />
          <button className="icon-btn" style={{ alignSelf: "center", marginRight: 6 }} title={agentOpen ? "Hide agent" : "Show agent"} onClick={() => setAgentOpen((o) => (store.set("fish.ideAgent", o ? "0" : "1"), !o))}>
            {agentOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
          </button>
        </div>
        <div className="editor">
          {current ? (
            <CodeEditor
              key={current.path}
              file={current.path}
              value={current.content}
              onChange={(v) => setTabs((ts) => ts.map((t) => (t.path === current.path ? { ...t, content: v } : t)))}
              onSave={() => save(current.path)}
            />
          ) : (
            <div className="welcome" style={{ height: "100%" }}>
              <div className="hero-logo"><FishLogo size={60} id="ide" /></div>
              <h2 style={{ fontSize: 22 }}>{basename(ws)}</h2>
              <p className="small">Open a file from the explorer, or ask Fish in the agent panel.</p>
              <div className="row small muted" style={{ gap: 18 }}>
                <span><kbd>Ctrl S</kbd> save</span>
                <span><kbd>Ctrl K</kbd> commands</span>
                <span><kbd>Ctrl N</kbd> new session</span>
              </div>
            </div>
          )}
        </div>
        <div className="statusbar">
          {git?.repo && <span className="row" style={{ gap: 5 }}><GitBranch size={12} /> {git.branch} {git.changes.length > 0 && `· ${git.changes.length} changed`}</span>}
          {current && <span>{current.path}</span>}
          {flash && <span className="flash">● {flash}</span>}
          <span className="grow" />
          {current && current.content !== current.saved && (
            <button className="btn xs" onClick={() => save(current.path)}><Save size={12} /> Save</button>
          )}
          {current && <span>{current.content.split("\n").length} lines</span>}
        </div>
      </section>

      {agentOpen && (
        <section className="agent-panel">
          <div className="panel-head">
            <Bot size={14} /> <span className="grow">Agent</span>
            <button className="icon-btn sm" title="New session" onClick={() => newSession()}><Plus size={14} /></button>
          </div>
          <ChatView sessionId={sessionId} compact />
        </section>
      )}
      {modal}
    </div>
  );
}
