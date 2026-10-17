import { useEffect, useRef, useState } from "react";
import { TerminalSquare, Save, RotateCcw, Copy, LogOut, Braces, UserRound, Variable, Check } from "lucide-react";
import { useApp } from "../App.jsx";
import { api, fmt } from "../api.js";
import { Switch } from "../components/ui.jsx";
import CodeEditor from "../components/CodeEditor.jsx";

export default function DevPage() {
  const { config, updateConfig, setView, toast } = useApp();
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("template");

  const load = () => api("/dev/prompt").then(setData).catch((e) => toast(e.message, "error"));
  useEffect(() => {
    load();
  }, [config.promptPreset, config.permissionMode, config.workspace]);

  const exit = async () => {
    await updateConfig({ devMode: false });
    toast("Dev-Mode off — custom template and persona edits are paused");
    setView("settings");
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1 className="row" style={{ gap: 10 }}><TerminalSquare size={24} /> Dev-Mode</h1>
            <p>Full control over the system prompt Fish sends with every request.</p>
          </div>
          <div className="actions">
            <div className="seg">
              <button className={tab === "template" ? "on" : ""} onClick={() => setTab("template")}><Braces size={13} /> Template</button>
              <button className={tab === "personas" ? "on" : ""} onClick={() => setTab("personas")}><UserRound size={13} /> Personas</button>
              <button className={tab === "vars" ? "on" : ""} onClick={() => setTab("vars")}><Variable size={13} /> Variables</button>
            </div>
            <button className="btn" onClick={exit}><LogOut size={14} /> Exit Dev-Mode</button>
          </div>
        </div>
        {!data ? null : tab === "template" ? (
          <TemplateEditor data={data} onSaved={load} />
        ) : tab === "personas" ? (
          <PersonaEditor data={data} onSaved={load} />
        ) : (
          <VariablesTable data={data} />
        )}
      </div>
    </div>
  );
}

function TemplateEditor({ data, onSaved }) {
  const { config, updateConfig, toast } = useApp();
  const saved = data.template?.text || data.defaultTemplate;
  const [text, setText] = useState(saved);
  const [enabled, setEnabled] = useState(Boolean(data.template?.enabled));
  const [preview, setPreview] = useState(data.rendered);
  const view = useRef(null);
  const dirty = text !== saved || enabled !== Boolean(data.template?.enabled);

  useEffect(() => {
    const t = setTimeout(() => {
      api("/dev/prompt/preview", { method: "POST", body: { template: text } }).then((r) => setPreview(r.text)).catch(() => {});
    }, 250);
    return () => clearTimeout(t);
  }, [text, config.appendPrompt]);

  const save = async (nextEnabled = enabled) => {
    await updateConfig({ promptTemplate: { enabled: nextEnabled, text } });
    toast(nextEnabled ? "Custom system prompt is live" : "Template saved (not active)");
    onSaved();
  };

  const insert = (name) => {
    const token = `{{${name}}}`;
    const v = view.current;
    if (!v) return setText((t) => t + token);
    const { from, to } = v.state.selection.main;
    v.dispatch({ changes: { from, to, insert: token }, selection: { anchor: from + token.length } });
    v.focus();
  };

  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="card setting" style={{ borderBottom: "1px solid var(--border)" }}>
        <div className="txt">
          <b>Use custom template</b>
          <span>{enabled ? "Fish builds its system prompt from the template below." : "Off — Fish uses the built-in layout. Edits are kept until you turn this on."}</span>
        </div>
        <div className="ctl" style={{ gap: 8 }}>
          <Switch on={enabled} onChange={(v) => { setEnabled(v); save(v); }} label="Use custom template" />
        </div>
      </div>

      <div className="grid c2" style={{ gap: 14, alignItems: "start" }}>
        <div className="card" style={{ overflow: "hidden" }}>
          <div className="row small" style={{ padding: "8px 10px 8px 14px", borderBottom: "1px solid var(--border)" }}>
            <b className="grow">Template</b>
            <button className="btn xs ghost" onClick={() => setText(data.defaultTemplate)} title="Replace with the built-in layout"><RotateCcw size={12} /> Default</button>
            <button className="btn xs primary" disabled={!dirty} onClick={() => save()}><Save size={12} /> Save</button>
          </div>
          <CodeEditor file="prompt.md" value={text} onChange={setText} height="460px" onSave={() => save()} onCreate={(v) => (view.current = v)} />
          <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", display: "flex", flexWrap: "wrap", gap: 6 }}>
            {data.variables.map((v) => (
              <button key={v.name} className="badge mono" style={{ cursor: "pointer" }} title={v.desc} onClick={() => insert(v.name)}>
                {`{{${v.name}}}`}
              </button>
            ))}
          </div>
        </div>

        <div className="card" style={{ overflow: "hidden" }}>
          <div className="row small" style={{ padding: "8px 10px 8px 14px", borderBottom: "1px solid var(--border)" }}>
            <b className="grow">Rendered</b>
            <span className="muted">{preview.length.toLocaleString()} chars · ≈ {fmt.tokens(preview.length / 4)} tokens</span>
            <button className="btn xs ghost" onClick={() => (navigator.clipboard?.writeText(preview), toast("Copied"))}><Copy size={12} /></button>
          </div>
          <CodeEditor file="system.md" value={preview} readOnly height="510px" />
        </div>
      </div>
      <span className="small muted">
        Unknown variables stay visible as <code>{"{{name}}"}</code> so typos show in the preview. Blank lines collapse automatically. Ctrl+S saves.
      </span>
    </div>
  );
}

function PersonaEditor({ data, onSaved }) {
  const { config, updateConfig, toast } = useApp();
  const [active, setActive] = useState(config.promptPreset === "custom" ? data.presets[0].id : config.promptPreset);
  const preset = data.presets.find((p) => p.id === active);
  const [text, setText] = useState(preset.override || preset.text);
  useEffect(() => setText(preset.override || preset.text), [active, data]);

  const save = async (value) => {
    const overrides = { ...(config.presetOverrides || {}) };
    if (!value || value === preset.text) delete overrides[preset.id];
    else overrides[preset.id] = value;
    await updateConfig({ presetOverrides: overrides });
    toast(value && value !== preset.text ? `${preset.name} updated` : `${preset.name} reset to built-in`);
    onSaved();
  };

  return (
    <div className="grid" style={{ gridTemplateColumns: "240px 1fr", gap: 14, alignItems: "start" }}>
      <div className="card" style={{ padding: 6 }}>
        {data.presets.map((p) => (
          <button key={p.id} className={`menu-item ${p.id === active ? "hl" : ""}`} onClick={() => setActive(p.id)}>
            <span className="grow">
              <div>{p.name}</div>
              <div className="sub">{p.override ? "Edited" : "Built-in"}{config.promptPreset === p.id && " · active"}</div>
            </span>
            {config.promptPreset === p.id && <Check size={14} className="check" />}
          </button>
        ))}
      </div>
      <div className="card" style={{ overflow: "hidden" }}>
        <div className="row small" style={{ padding: "8px 10px 8px 14px", borderBottom: "1px solid var(--border)" }}>
          <b className="grow">{preset.name} <span className="muted" style={{ fontWeight: 400 }}>— fills {"{{base}}"}</span></b>
          {config.promptPreset !== preset.id && <button className="btn xs ghost" onClick={() => updateConfig({ promptPreset: preset.id })}>Make active</button>}
          <button className="btn xs ghost" disabled={!preset.override} onClick={() => save("")}><RotateCcw size={12} /> Reset</button>
          <button className="btn xs primary" disabled={text === (preset.override || preset.text)} onClick={() => save(text)}><Save size={12} /> Save</button>
        </div>
        <CodeEditor file="persona.md" value={text} onChange={setText} height="440px" onSave={() => save(text)} />
      </div>
    </div>
  );
}

function VariablesTable({ data }) {
  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <table className="table">
        <thead><tr><th style={{ width: 170 }}>Variable</th><th style={{ width: 260 }}>Meaning</th><th>Current value</th></tr></thead>
        <tbody>
          {data.variables.map((v) => (
            <tr key={v.name}>
              <td className="mono small">{`{{${v.name}}}`}</td>
              <td className="small muted">{v.desc}</td>
              <td className="mono small" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxWidth: 0 }}>
                {v.value ? (v.value.length > 240 ? v.value.slice(0, 240) + "…" : v.value) : <span className="muted">(empty)</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
