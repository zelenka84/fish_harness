import { useState } from "react";
import { KeyRound, Cpu, Shield, Palette, Wrench, Plus, Trash2, FolderOpen, Eye, EyeOff, Server } from "lucide-react";
import { useApp } from "../App.jsx";
import { Switch, Modal } from "../components/ui.jsx";
import { MODES } from "../components/Composer.jsx";
import { useWorkspacePicker } from "./ChatView.jsx";

export default function SettingsPage() {
  const { state, config, updateConfig, toast } = useApp();
  const { pick, modal } = useWorkspacePicker();
  const [addingProvider, setAddingProvider] = useState(false);
  const anthropic = config.providers.find((p) => p.id === "anthropic");

  const saveProvider = async (p) => {
    const providers = config.providers.some((x) => x.id === p.id) ? config.providers.map((x) => (x.id === p.id ? p : x)) : [...config.providers, p];
    await updateConfig({ providers });
    toast("Provider saved");
  };

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 900 }}>
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <p>Stored in <code>{state.home}</code></p>
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 0 }}><KeyRound size={15} /> API access</div>
        <div className="card">
          <ApiKeyRow provider={anthropic} onSave={saveProvider} />
          {config.providers.filter((p) => p.type === "openai").map((p) => (
            <div key={p.id} className="setting">
              <div className="txt">
                <b>{p.name}</b>
                <span className="mono">{p.baseURL} · {(p.models || []).join(", ")}</span>
              </div>
              <div className="ctl">
                <button className="btn sm danger" onClick={() => updateConfig({ providers: config.providers.filter((x) => x.id !== p.id) })}><Trash2 size={14} /> Remove</button>
              </div>
            </div>
          ))}
          <div className="setting">
            <div className="txt">
              <b>OpenAI-compatible provider</b>
              <span>Run local or third-party models (Ollama, LM Studio, OpenRouter, vLLM) through the same harness.</span>
            </div>
            <div className="ctl"><button className="btn sm" onClick={() => setAddingProvider(true)}><Plus size={14} /> Add provider</button></div>
          </div>
        </div>

        <div className="section-title"><Cpu size={15} /> Model</div>
        <div className="card">
          <Setting title="Default model" desc="Used for new sessions. Change per session from the composer.">
            <select className="select" value={config.model} onChange={(e) => updateConfig({ model: e.target.value })}>
              {state.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              {config.providers.filter((p) => p.type === "openai").flatMap((p) => (p.models || []).map((id) => <option key={id} value={id}>{id} ({p.name})</option>))}
            </select>
          </Setting>
          <Setting title="Reasoning effort" desc="Higher effort thinks longer and uses more tokens.">
            <div className="seg">
              {state.efforts.map((e) => <button key={e} className={config.effort === e ? "on" : ""} onClick={() => updateConfig({ effort: e })}>{e}</button>)}
            </div>
          </Setting>
          <Setting title="Max output tokens" desc="Per model response. Streaming keeps large values safe.">
            <input className="input mono" type="number" min={1024} max={128000} step={1024} value={config.maxTokens} onChange={(e) => updateConfig({ maxTokens: Number(e.target.value) })} style={{ width: 140 }} />
          </Setting>
          <Setting title="Show reasoning" desc="Stream a readable summary of the model's thinking.">
            <Switch on={config.thinkingDisplay === "summarized"} onChange={(v) => updateConfig({ thinkingDisplay: v ? "summarized" : "omitted" })} />
          </Setting>
          <Setting title="Prompt caching" desc="Reuses the conversation prefix between turns — much cheaper and faster.">
            <Switch on={config.promptCaching} onChange={(v) => updateConfig({ promptCaching: v })} />
          </Setting>
          <Setting title="Refusal fallback" desc="If a safety classifier declines a request, retry it on a fallback model server-side.">
            <Switch on={config.refusalFallback} onChange={(v) => updateConfig({ refusalFallback: v })} />
          </Setting>
          <Setting title="Web search" desc="Let Claude search the web (server-side tool, billed per search).">
            <Switch on={config.webSearch} onChange={(v) => updateConfig({ webSearch: v })} />
          </Setting>
        </div>

        <div className="section-title"><Shield size={15} /> Permissions & workspace</div>
        <div className="card">
          <Setting title="Permission mode" desc={MODES.find((m) => m.id === config.permissionMode)?.sub}>
            <select className="select" value={config.permissionMode} onChange={(e) => updateConfig({ permissionMode: e.target.value })}>
              {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </Setting>
          <Setting title="Default workspace" desc={<span className="mono">{config.workspace}</span>}>
            <button className="btn sm" onClick={async () => { const d = await pick(config.workspace); if (d) updateConfig({ workspace: d }); }}><FolderOpen size={14} /> Change</button>
          </Setting>
        </div>

        <div className="section-title"><Wrench size={15} /> Built-in tools</div>
        <div className="card">
          {state.tools.map((t) => (
            <Setting key={t.name} title={<span className="mono">{t.name}</span>} desc={t.description}>
              <span className={`badge ${t.kind === "exec" ? "warn" : t.kind === "write" ? "violet" : "accent"}`} style={{ marginRight: 10 }}>{t.kind}</span>
              <Switch
                on={!config.disabledTools.includes(t.name)}
                onChange={(v) => updateConfig({ disabledTools: v ? config.disabledTools.filter((n) => n !== t.name) : [...config.disabledTools, t.name] })}
              />
            </Setting>
          ))}
        </div>

        <div className="section-title"><Palette size={15} /> Appearance</div>
        <div className="card">
          <Setting title="Theme" desc="Deep-sea dark or daylight.">
            <div className="seg">
              <button className={config.theme === "dark" ? "on" : ""} onClick={() => updateConfig({ theme: "dark" })}>Dark</button>
              <button className={config.theme === "light" ? "on" : ""} onClick={() => updateConfig({ theme: "light" })}>Light</button>
            </div>
          </Setting>
        </div>
      </div>
      {addingProvider && <ProviderModal onClose={() => setAddingProvider(false)} onSave={async (p) => { await saveProvider(p); setAddingProvider(false); }} />}
      {modal}
    </div>
  );
}

function Setting({ title, desc, children }) {
  return (
    <div className="setting">
      <div className="txt"><b>{title}</b><span>{desc}</span></div>
      <div className="ctl">{children}</div>
    </div>
  );
}

function ApiKeyRow({ provider, onSave }) {
  const [key, setKey] = useState("");
  const [base, setBase] = useState(provider?.baseURL || "");
  const [show, setShow] = useState(false);
  return (
    <div className="setting" style={{ alignItems: "flex-start" }}>
      <div className="txt">
        <b className="row" style={{ gap: 8 }}><Server size={15} /> Anthropic API key {provider?.hasKey && <span className="badge good">Connected</span>}</b>
        <span>{provider?.apiKey ? `Current: ${provider.apiKey}` : provider?.hasKey ? "Using ANTHROPIC_API_KEY from your environment." : "Get a key at console.anthropic.com → API keys."}</span>
        <div className="col" style={{ marginTop: 12, gap: 8 }}>
          <div className="row">
            <div style={{ position: "relative" }} className="grow">
              <input className="input mono" type={show ? "text" : "password"} placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
              <button className="icon-btn sm" style={{ position: "absolute", right: 6, top: 7 }} onClick={() => setShow((s) => !s)}>{show ? <EyeOff size={14} /> : <Eye size={14} />}</button>
            </div>
            <button className="btn primary" disabled={!key && base === (provider?.baseURL || "")} onClick={() => { onSave({ ...provider, apiKey: key || provider.apiKey, baseURL: base }); setKey(""); }}>Save</button>
          </div>
          <input className="input mono" placeholder="Custom base URL (optional, e.g. a proxy)" value={base} onChange={(e) => setBase(e.target.value)} />
        </div>
      </div>
    </div>
  );
}

function ProviderModal({ onClose, onSave }) {
  const [p, setP] = useState({ name: "Ollama", baseURL: "http://localhost:11434/v1", apiKey: "", models: "qwen3-coder" });
  const set = (k) => (e) => setP((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal
      title="Add OpenAI-compatible provider"
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => onSave({ id: `p_${Date.now().toString(36)}`, type: "openai", name: p.name, baseURL: p.baseURL, apiKey: p.apiKey, models: p.models.split(",").map((m) => m.trim()).filter(Boolean) })}>Add</button></>}
    >
      <label className="field">Name<input className="input" value={p.name} onChange={set("name")} /></label>
      <label className="field">Base URL<input className="input mono" value={p.baseURL} onChange={set("baseURL")} /></label>
      <label className="field">API key <span className="hint">Optional for local servers</span><input className="input mono" type="password" value={p.apiKey} onChange={set("apiKey")} /></label>
      <label className="field">Models <span className="hint">Comma-separated model ids</span><input className="input mono" value={p.models} onChange={set("models")} /></label>
    </Modal>
  );
}
