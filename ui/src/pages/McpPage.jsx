import { useEffect, useState } from "react";
import { Plug, Plus, RefreshCw, Trash2, Download, ChevronRight, TerminalSquare, Globe, KeyRound, Server } from "lucide-react";
import { useApp } from "../App.jsx";
import { api } from "../api.js";
import { Modal, Switch } from "../components/ui.jsx";
import { ProvidersSection } from "../components/Providers.jsx";

export default function McpPage() {
  const { config, updateConfig, toast, setView } = useApp();
  const [status, setStatus] = useState([]);
  const [adding, setAdding] = useState(null);
  const [discovered, setDiscovered] = useState(null);
  const [expanded, setExpanded] = useState(null);

  const load = () => api("/mcp").then(setStatus).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, []);

  const servers = config.mcpServers || [];
  const byName = new Map(status.map((s) => [s.name, s]));

  const saveServers = async (list) => {
    await updateConfig({ mcpServers: list });
    load();
  };
  const upsert = async (server) => {
    const list = servers.filter((s) => s.name !== server.name && s.name !== adding?.original);
    await saveServers([...list, server]);
    toast(`Connected "${server.name}"`);
    setAdding(null);
  };
  const remove = async (name) => {
    if (!confirm(`Remove MCP server "${name}"?`)) return;
    await saveServers(servers.filter((s) => s.name !== name));
  };
  const toggle = (name, enabled) => saveServers(servers.map((s) => (s.name === name ? { ...s, enabled } : s)));
  const reconnect = async (name) => setStatus(await api(`/mcp/${encodeURIComponent(name)}/reconnect`, { method: "POST" }));


  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Connections</h1>
            <p>Model APIs and MCP servers that give Fish its brains and its hands.</p>
          </div>
          <div className="actions">
            <button className="btn" onClick={async () => setDiscovered(await api("/mcp/discover"))}>
              <Download size={15} /> Import
            </button>
            <button className="btn primary" onClick={() => setAdding({ name: "", type: "stdio", command: "npx", args: [], env: {}, url: "", headers: {}, enabled: true })}>
              <Plus size={16} /> Add MCP server
            </button>
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 0 }}><KeyRound size={15} /> Model providers</div>
        <ProvidersSection />

        <div className="section-title"><Plug size={15} /> MCP servers</div>
        {servers.length === 0 ? (
          <div className="empty">
            <Plug size={26} />
            <b style={{ color: "var(--text)" }}>No MCP servers yet</b>
            Add one manually or import the servers you already use in Claude Desktop, Claude Code or Cursor.
          </div>
        ) : (
          <div className="card">
            {servers.map((s) => {
              const st = byName.get(s.name) || { status: s.enabled === false ? "disabled" : "connecting", tools: [] };
              const open = expanded === s.name;
              return (
                <div key={s.name} style={{ borderBottom: "1px solid var(--border)" }}>
                  <div className="list-item" style={{ borderBottom: 0 }}>
                    <button className="icon-btn sm" onClick={() => setExpanded(open ? null : s.name)}>
                      <ChevronRight size={15} style={{ transform: open ? "rotate(90deg)" : "", transition: "transform .15s" }} />
                    </button>
                    <span className={`dot ${st.status === "connected" ? "good" : st.status === "error" ? "bad" : st.status === "connecting" ? "warn" : ""}`} />
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="row" style={{ gap: 8 }}>
                        <b>{s.name}</b>
                        <span className="badge">{s.type === "stdio" ? <TerminalSquare size={11} /> : <Globe size={11} />} {s.type}</span>
                        {st.status === "connected" && <span className="badge accent">{st.tools.length} tools</span>}
                      </div>
                      <div className="small muted mono ellipsis">{st.error || (s.type === "stdio" ? `${s.command} ${(s.args || []).join(" ")}` : s.url)}</div>
                    </div>
                    <button className="icon-btn" title="Reconnect" onClick={() => reconnect(s.name)}><RefreshCw size={15} /></button>
                    <button className="btn sm ghost" onClick={() => setAdding({ ...s, original: s.name })}>Edit</button>
                    <button className="icon-btn" title="Remove" onClick={() => remove(s.name)}><Trash2 size={15} /></button>
                    <Switch on={s.enabled !== false} onChange={(v) => toggle(s.name, v)} label="Enabled" />
                  </div>
                  {open && (
                    <div style={{ padding: "0 18px 14px 60px" }}>
                      {st.tools.length ? st.tools.map((t) => (
                        <div key={t.name} className="small" style={{ padding: "5px 0" }}>
                          <code>{t.name}</code> <span className="muted">— {t.description?.slice(0, 140)}</span>
                        </div>
                      )) : <div className="small muted">No tools available.</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {adding && <ServerModal server={adding} onClose={() => setAdding(null)} onSave={upsert} />}
      {discovered && (
        <Modal title="Import MCP servers" icon={<Download size={20} style={{ color: "var(--accent)" }} />} onClose={() => setDiscovered(null)}>
          {discovered.length === 0 && <div className="muted">No configs found for Claude Desktop, Claude Code or Cursor.</div>}
          {discovered.map((d) => {
            const exists = servers.some((s) => s.name === d.name);
            return (
              <div key={d.from + d.name} className="row card" style={{ padding: "10px 14px" }}>
                <div className="grow" style={{ minWidth: 0 }}>
                  <b>{d.name}</b> <span className="badge violet">{d.from}</span>
                  <div className="small muted mono ellipsis">{d.command ? `${d.command} ${d.args.join(" ")}` : d.url}</div>
                </div>
                <button className="btn sm" disabled={exists} onClick={async () => { const { from, ...srv } = d; await saveServers([...servers, srv]); toast(`Imported ${d.name}`); }}>
                  {exists ? "Added" : "Import"}
                </button>
              </div>
            );
          })}
        </Modal>
      )}
    </div>
  );
}

function ServerModal({ server, onClose, onSave }) {
  const [s, setS] = useState({ ...server, argsText: (server.args || []).join("\n"), envText: Object.entries(server.env || {}).map(([k, v]) => `${k}=${v}`).join("\n"), headersText: Object.entries(server.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n") });
  const set = (k) => (e) => setS((x) => ({ ...x, [k]: e.target.value }));
  const submit = () => {
    if (!s.name.trim()) return;
    const parsePairs = (text, sep) => Object.fromEntries(text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { const i = l.indexOf(sep); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
    const { argsText, envText, headersText, original, ...rest } = s;
    onSave({
      ...rest,
      name: s.name.trim().replace(/\s+/g, "-"),
      args: argsText.split("\n").map((a) => a.trim()).filter(Boolean),
      env: parsePairs(envText, "="),
      headers: parsePairs(headersText, ":"),
    });
  };
  return (
    <Modal
      title={server.original ? `Edit ${server.original}` : "Add MCP server"}
      icon={<Plug size={20} style={{ color: "var(--accent)" }} />}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={submit}>Save & connect</button></>}
    >
      <label className="field">Name<input className="input" value={s.name} onChange={set("name")} placeholder="github" autoFocus /></label>
      <div className="seg" style={{ alignSelf: "flex-start" }}>
        {["stdio", "http", "sse"].map((t) => <button key={t} className={s.type === t ? "on" : ""} onClick={() => setS((x) => ({ ...x, type: t }))}>{t === "stdio" ? "Local (stdio)" : t === "http" ? "Remote (HTTP)" : "SSE"}</button>)}
      </div>
      {s.type === "stdio" ? (
        <>
          <label className="field">Command<input className="input mono" value={s.command} onChange={set("command")} placeholder="npx" /></label>
          <label className="field">Arguments <span className="hint">One per line</span><textarea className="textarea" rows={3} value={s.argsText} onChange={set("argsText")} placeholder={"-y\n@modelcontextprotocol/server-filesystem\nC:\\projects"} /></label>
          <label className="field">Environment <span className="hint">KEY=value per line</span><textarea className="textarea" rows={2} value={s.envText} onChange={set("envText")} placeholder="GITHUB_TOKEN=…" /></label>
        </>
      ) : (
        <>
          <label className="field">URL<input className="input mono" value={s.url} onChange={set("url")} placeholder="https://example.com/mcp" /></label>
          <label className="field">Headers <span className="hint">Name: value per line</span><textarea className="textarea" rows={2} value={s.headersText} onChange={set("headersText")} placeholder="Authorization: Bearer …" /></label>
        </>
      )}
    </Modal>
  );
}
