import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  MessagesSquare, Code2, Sparkles, Plug, ScrollText, BarChart3, Users, Settings as SettingsIcon, Search, Plus, Sun, Moon,
  PanelLeftClose, PanelLeft, Pin, Trash2, Lock, TerminalSquare,
} from "lucide-react";
import { api, store, fmt, basename } from "./api.js";
import { FishLogo, useToast, Avatar } from "./components/ui.jsx";
import { useAgent, loadSession, forget } from "./agentStore.js";
import ChatView from "./pages/ChatView.jsx";
import IdeView from "./pages/IdeView.jsx";
import SkillsPage from "./pages/SkillsPage.jsx";
import McpPage from "./pages/McpPage.jsx";
import PromptPage from "./pages/PromptPage.jsx";
import StatsPage from "./pages/StatsPage.jsx";
import AccountsPage from "./pages/AccountsPage.jsx";
import SettingsPage from "./pages/SettingsPage.jsx";
import DevPage from "./pages/DevPage.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import { providerReady } from "./models.js";
import Onboarding from "./components/Onboarding.jsx";

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const VIEWS = [
  { id: "chat", label: "Code", icon: MessagesSquare, key: "1" },
  { id: "ide", label: "IDE", icon: Code2, key: "2" },
  { id: "skills", label: "Skills", icon: Sparkles, key: "3" },
  { id: "mcp", label: "Connections", icon: Plug, key: "4" },
  { id: "prompt", label: "System prompt", icon: ScrollText, key: "5" },
  { id: "stats", label: "Statistics", icon: BarChart3, key: "6" },
];

export default function App() {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [view, setViewRaw] = useState(store.get("fish.view", "chat"));
  const [activeId, setActiveId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(store.get("fish.sidebar", "1") === "1");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [locked, setLocked] = useState(false);
  const [accountId, setAccountId] = useState(store.get("fish.account", "local"));

  const setView = useCallback((v) => {
    setViewRaw(v);
    store.set("fish.view", v);
  }, []);

  const refreshState = useCallback(async () => {
    try {
      const s = await api("/state");
      setState(s);
      setError(null);
      document.documentElement.dataset.theme = s.config.theme;
      return s;
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await api("/sessions"));
      setLocked(false);
    } catch (e) {
      if (e.status === 401) setLocked(true);
    }
  }, []);

  useEffect(() => {
    refreshState();
  }, [refreshState]);
  useEffect(() => {
    refreshSessions();
  }, [refreshSessions, accountId]);

  const updateConfig = useCallback(
    async (patch) => {
      const config = await api("/config", { method: "PUT", body: patch });
      setState((s) => ({ ...s, config }));
      if (patch.theme) document.documentElement.dataset.theme = patch.theme;
      return config;
    },
    [],
  );

  const openSession = useCallback(
    async (id, { keepView } = {}) => {
      setActiveId(id);
      store.set("fish.session", id);
      if (!keepView && view !== "chat" && view !== "ide") setView("chat");
      try {
        await loadSession(id);
      } catch (e) {
        toast(e.message, "error");
      }
    },
    [view, setView, toast],
  );

  const newSession = useCallback(
    async (opts = {}) => {
      const s = await api("/sessions", { method: "POST", body: opts });
      await refreshSessions();
      await openSession(s.id);
      return s;
    },
    [refreshSessions, openSession],
  );

  // Restore the last session.
  useEffect(() => {
    if (activeId || !sessions.length) return;
    const last = store.get("fish.session");
    const pick = sessions.find((s) => s.id === last) || null;
    if (pick) openSession(pick.id, { keepView: true });
  }, [sessions, activeId, openSession]);

  const switchAccount = useCallback(
    async (acc, password) => {
      if (acc.protected) {
        const { token } = await api(`/accounts/${acc.id}/login`, { method: "POST", body: { password } });
        store.set("fish.token", token);
      } else store.set("fish.token", null);
      store.set("fish.account", acc.id);
      store.set("fish.session", null);
      setAccountId(acc.id);
      setActiveId(null);
      setLocked(false);
      toast(`Signed in as ${acc.name}`);
    },
    [toast],
  );

  // Global shortcuts
  useEffect(() => {
    const onKey = (e) => {
      if (e.defaultPrevented) return; // the editor or an IDE panel already handled it
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      } else if (mod && e.key.toLowerCase() === "n" && !e.shiftKey) {
        e.preventDefault();
        newSession();
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((o) => (store.set("fish.sidebar", o ? "0" : "1"), !o));
      } else if (mod && /^[1-6]$/.test(e.key)) {
        e.preventDefault();
        setView(VIEWS[Number(e.key) - 1].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newSession, setView]);

  const account = state?.accounts.find((a) => a.id === accountId) || state?.accounts[0];

  const value = useMemo(
    () => ({
      state, config: state?.config, updateConfig, refreshState, sessions, refreshSessions, activeId, setActiveId, openSession, newSession,
      view, setView, toast, account, switchAccount, setPaletteOpen,
    }),
    [state, updateConfig, refreshState, sessions, refreshSessions, activeId, openSession, newSession, view, setView, toast, account, switchAccount],
  );

  if (error && !state) {
    return (
      <div className="lock">
        <div className="card">
          <FishLogo size={48} />
          <h2>Can't reach the Fish server</h2>
          <p className="muted small">{error}. Start it with <code>fish serve</code> or <code>npm run dev</code>.</p>
          <button className="btn primary" onClick={refreshState}>Retry</button>
        </div>
      </div>
    );
  }
  if (!state) return <Splash />;

  const isElectron = navigator.userAgent.includes("Electron");
  const theme = state.config.theme;
  const hasKey = state.config.providers.some(providerReady);

  return (
    <Ctx.Provider value={value}>
      <div className="ambient"><div className="grain" /></div>
      <div className="app" style={{ "--overlay-pad": isElectron && state.platform !== "darwin" ? "138px" : "0px" }}>
        <header className="titlebar" style={isElectron && state.platform === "darwin" ? { paddingLeft: 82 } : undefined}>
          <div className="brand">
            <FishLogo size={20} id="tb" />
            Fish Harness <small>v{state.version}</small>
            {state.config.devMode && <span className="badge dev-badge no-drag" onClick={() => setView("dev")}>DEV</span>}
          </div>
          <div className="center">
            <button className="search-trigger no-drag" onClick={() => setPaletteOpen(true)}>
              <Search size={14} /> Search sessions, commands, settings… <kbd>Ctrl K</kbd>
            </button>
          </div>
          <div className="right">
            <button className="icon-btn" title="Toggle theme" onClick={(e) => switchTheme(e, theme === "dark" ? "light" : "dark", updateConfig)}>
              {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </header>

        <div className="body" style={{ gridTemplateColumns: view === "chat" ? "64px auto 1fr" : "64px 0 1fr" }}>
          <nav className="rail" aria-label="Main">
            {VIEWS.map((v) => (
              <button key={v.id} className={`rail-btn ${view === v.id ? "active" : ""}`} onClick={() => setView(v.id)} aria-label={v.label}>
                <v.icon size={19} strokeWidth={1.8} />
                <span className="tip">{v.label} <kbd>Ctrl {v.key}</kbd></span>
              </button>
            ))}
            <div className="spacer" />
            {state.config.devMode && (
              <button className={`rail-btn ${view === "dev" ? "active" : ""}`} onClick={() => setView("dev")} aria-label="Dev-Mode">
                <TerminalSquare size={19} strokeWidth={1.8} />
                <span className="tip">Dev-Mode</span>
              </button>
            )}
            <button className={`rail-btn ${view === "settings" ? "active" : ""}`} onClick={() => setView("settings")} aria-label="Settings">
              <SettingsIcon size={19} strokeWidth={1.8} />
              <span className="tip">Settings</span>
            </button>
            <button className={`rail-btn ${view === "accounts" ? "active" : ""}`} onClick={() => setView("accounts")} aria-label="Accounts">
              <Avatar account={account} size={28} />
              <span className="tip">{account?.name} · Accounts</span>
            </button>
          </nav>

          {view === "chat" ? (
            <SessionSidebar open={sidebarOpen} setOpen={(o) => (store.set("fish.sidebar", o ? "1" : "0"), setSidebarOpen(o))} />
          ) : (
            <div />
          )}

          <main className="main">
            {!hasKey && (view === "chat" || view === "ide") && <Onboarding />}
            <div key={view} className="view-anim">
            {view === "chat" && <ChatView sessionId={activeId} sidebarOpen={sidebarOpen} onToggleSidebar={() => setSidebarOpen((o) => (store.set("fish.sidebar", o ? "0" : "1"), !o))} />}
            {view === "ide" && <IdeView sessionId={activeId} />}
            {view === "skills" && <SkillsPage />}
            {view === "mcp" && <McpPage />}
            {view === "prompt" && <PromptPage />}
            {view === "stats" && <StatsPage />}
            {view === "accounts" && <AccountsPage />}
            {view === "settings" && <SettingsPage />}
            {view === "dev" && (state.config.devMode ? <DevPage /> : <SettingsPage />)}
            </div>
          </main>
        </div>
      </div>
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
      {locked && <LockScreen />}
    </Ctx.Provider>
  );
}

function Splash() {
  return (
    <div className="lock">
      <div className="hero-logo"><FishLogo size={64} /></div>
    </div>
  );
}

function LockScreen() {
  const { account, switchAccount, state } = useApp();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const submit = async (e) => {
    e.preventDefault();
    try {
      await switchAccount(account, pw);
      window.location.reload();
    } catch (e2) {
      setErr(e2.message);
    }
  };
  return (
    <div className="lock">
      <form className="card col" onSubmit={submit} style={{ alignItems: "center", gap: 14 }}>
        <Avatar account={account} size={56} />
        <div>
          <h2 style={{ margin: "6px 0 2px" }}>{account?.name}</h2>
          <div className="muted small"><Lock size={12} /> This account is protected</div>
        </div>
        <input className="input" type="password" autoFocus placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} />
        {err && <div className="small" style={{ color: "var(--bad)" }}>{err}</div>}
        <button className="btn primary block">Unlock</button>
        <div className="row small muted" style={{ flexWrap: "wrap", justifyContent: "center" }}>
          {state.accounts.filter((a) => a.id !== account?.id && !a.protected).map((a) => (
            <button key={a.id} type="button" className="btn ghost xs" onClick={() => switchAccount(a).then(() => window.location.reload())}>
              Use {a.name}
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}

function SessionSidebar({ open, setOpen }) {
  const { sessions, activeId, openSession, newSession, refreshSessions, toast, setActiveId } = useApp();
  const [q, setQ] = useState("");
  const live = useAgent(activeId);

  const groups = useMemo(() => {
    const filtered = sessions.filter((s) => !q || s.title.toLowerCase().includes(q.toLowerCase()) || s.preview.toLowerCase().includes(q.toLowerCase()));
    const now = Date.now();
    const out = { Pinned: [], Today: [], "This week": [], Older: [] };
    for (const s of filtered) {
      if (s.pinned) out.Pinned.push(s);
      else if (now - s.updatedAt < 86_400_000) out.Today.push(s);
      else if (now - s.updatedAt < 604_800_000) out["This week"].push(s);
      else out.Older.push(s);
    }
    return Object.entries(out).filter(([, v]) => v.length);
  }, [sessions, q]);

  const remove = async (s, e) => {
    e.stopPropagation();
    await api(`/sessions/${s.id}`, { method: "DELETE" });
    forget(s.id);
    if (activeId === s.id) setActiveId(null);
    refreshSessions();
    toast("Session deleted");
  };
  const pin = async (s, e) => {
    e.stopPropagation();
    await api(`/sessions/${s.id}`, { method: "PATCH", body: { pinned: !s.pinned } });
    refreshSessions();
  };

  return (
    <aside className={`sidebar ${open ? "" : "collapsed"}`}>
      <div className="sidebar-head">
        <div className="row">
          <button className="btn primary grow" onClick={() => newSession()}>
            <Plus size={16} /> New session
          </button>
          <button className="icon-btn" onClick={() => setOpen(false)} title="Hide sidebar (Ctrl B)">
            <PanelLeftClose size={17} />
          </button>
        </div>
        <div style={{ position: "relative" }}>
          <Search size={14} style={{ position: "absolute", left: 11, top: 10, color: "var(--text-4)" }} />
          <input className="input" style={{ paddingLeft: 32, height: 34, fontSize: 13 }} placeholder="Filter sessions" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </div>
      <div className="sidebar-list">
        {!sessions.length && <div className="muted small" style={{ padding: "20px 10px", textAlign: "center" }}>No sessions yet.<br />Start one to begin.</div>}
        {groups.map(([label, list]) => (
          <div key={label}>
            <div className="group-label">{label}</div>
            {list.map((s) => (
              <button key={s.id} className={`session-item ${activeId === s.id ? "active" : ""}`} onClick={() => openSession(s.id)}>
                <span className="t">{s.title}</span>
                <span className="m">
                  {activeId === s.id && live?.running && <span className="live-dot" />}
                  {basename(s.workspace)} · {fmt.ago(s.updatedAt)}
                  {s.cost > 0 && <> · {fmt.cost(s.cost)}</>}
                </span>
                <span className="acts">
                  <span className="icon-btn sm" role="button" title={s.pinned ? "Unpin" : "Pin"} onClick={(e) => pin(s, e)}><Pin size={13} /></span>
                  <span className="icon-btn sm" role="button" title="Delete" onClick={(e) => remove(s, e)}><Trash2 size={13} /></span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  );
}

export function SidebarToggle({ open, onToggle }) {
  if (open) return null;
  return (
    <button className="icon-btn" onClick={onToggle} title="Show sidebar (Ctrl B)">
      <PanelLeft size={17} />
    </button>
  );
}

/** Theme switch with a circular reveal from the button (View Transitions API when available). */
function switchTheme(e, next, updateConfig) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (!document.startViewTransition || reduce) return updateConfig({ theme: next });
  const x = e.clientX;
  const y = e.clientY;
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
  const t = document.startViewTransition(() => {
    document.documentElement.dataset.theme = next;
  });
  t.ready.then(() => {
    document.documentElement.animate(
      { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${r}px at ${x}px ${y}px)`] },
      { duration: 520, easing: "cubic-bezier(.2,.8,.2,1)", pseudoElement: "::view-transition-new(root)" },
    );
  });
  updateConfig({ theme: next });
}
