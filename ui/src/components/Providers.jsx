import { useMemo, useState } from "react";
import { Plus, Trash2, RefreshCw, Search, ExternalLink, ChevronLeft, Check, KeyRound, Server, PenLine } from "lucide-react";
import { useApp } from "../App.jsx";
import { api } from "../api.js";
import { Modal } from "./ui.jsx";
import { modelKey, providerReady } from "../models.js";

const CUSTOM = [
  { preset: "custom-openai", name: "Custom", type: "openai", baseURL: "", custom: true, sub: "OpenAI-compatible API" },
  { preset: "custom-anthropic", name: "Custom", type: "anthropic", baseURL: "", custom: true, sub: "Anthropic-compatible API" },
];

function Monogram({ name, size = 34 }) {
  const letters = name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";
  return (
    <span style={{ width: size, height: size, borderRadius: 7, display: "grid", placeItems: "center", flex: "none", background: "var(--surface-3)", border: "1px solid var(--border-2)", fontWeight: 650, fontSize: size * 0.36, color: "var(--text)" }}>
      {letters}
    </span>
  );
}

/** List of configured providers with add / edit / remove. */
export function ProvidersSection() {
  const { config, updateConfig, toast } = useApp();
  const [editing, setEditing] = useState(null); // provider | "new"

  const remove = async (p) => {
    if (!confirm(`Remove provider "${p.name}"?`)) return;
    const patch = { providers: config.providers.filter((x) => x.id !== p.id) };
    if (config.model.startsWith(`${p.id}::`)) patch.model = "claude-opus-5-5";
    await updateConfig(patch);
    toast(`Removed ${p.name}`);
  };

  return (
    <>
      <div className="card">
        {config.providers.map((p) => {
          const ready = providerReady(p);
          const isAnthropic = p.id === "anthropic";
          return (
            <div key={p.id} className="list-item">
              <Monogram name={p.name} />
              <div className="grow" style={{ minWidth: 0 }}>
                <div className="row" style={{ gap: 8 }}>
                  <b>{p.name}</b>
                  <span className="badge">{p.type === "anthropic" ? "Anthropic API" : "OpenAI API"}</span>
                  {!isAnthropic && <span className="badge">{(p.models || []).length} models</span>}
                </div>
                <div className="small muted mono ellipsis">
                  {p.baseURL || (isAnthropic ? "api.anthropic.com" : "")}
                  {p.apiKey ? ` · key ${p.apiKey}` : p.hasKey ? " · key from environment" : ""}
                </div>
              </div>
              <span className={`dot ${ready ? "good" : ""}`} title={ready ? "Ready" : "No API key"} />
              <button className="btn sm" onClick={() => setEditing(p)}><PenLine size={13} /> {ready ? "Edit" : "Connect"}</button>
              {!isAnthropic && (
                <button className="icon-btn" title="Remove" onClick={() => remove(p)}><Trash2 size={15} /></button>
              )}
            </div>
          );
        })}
        <div className="list-item">
          <span style={{ width: 34, height: 34, borderRadius: 7, display: "grid", placeItems: "center", border: "1px dashed var(--border-3)", color: "var(--text-3)" }}><Plus size={16} /></span>
          <div className="grow">
            <b>Add provider</b>
            <div className="small muted">OpenAI, OpenRouter, Gemini, DeepSeek, Ollama… or any compatible endpoint.</div>
          </div>
          <button className="btn sm primary" onClick={() => setEditing("new")}><Plus size={14} /> Add</button>
        </div>
      </div>
      {editing && <ProviderModal initial={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

export function ProviderModal({ initial, onClose }) {
  const { state, config, updateConfig, toast } = useApp();
  const presets = state.providerPresets || [];
  const [step, setStep] = useState(initial ? "form" : "pick");
  const [form, setForm] = useState(() =>
    initial
      ? { ...initial, priceIn: initial.pricing?.input ?? "", priceOut: initial.pricing?.output ?? "" }
      : null,
  );
  const [available, setAvailable] = useState(null);
  const [pricing, setPricing] = useState(() => initial?.modelPricing || {});
  const [selected, setSelected] = useState(() => new Set(initial?.models || []));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [manual, setManual] = useState("");
  const isAnthropic = form?.id === "anthropic";
  const preset = presets.find((p) => p.preset === form?.preset);

  const pick = (p) => {
    setForm({ preset: p.preset, type: p.type, name: p.custom ? "" : p.name, baseURL: p.baseURL, apiKey: "", priceIn: "", priceOut: "", custom: p.custom, local: p.local });
    setSelected(new Set());
    setAvailable(null);
    setStep("form");
  };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const loadModels = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await api("/providers/models", { method: "POST", body: { id: form.id, type: form.type, baseURL: form.baseURL, apiKey: form.apiKey } });
      const models = res.models || [];
      setAvailable(models);
      setPricing((p) => ({ ...p, ...(res.pricing || {}) }));
      if (!models.length) setError("The provider returned no models. Add model ids manually below.");
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  const toggle = (m) =>
    setSelected((s) => {
      const n = new Set(s);
      n.has(m) ? n.delete(m) : n.add(m);
      return n;
    });

  const addManual = () => {
    const ids = manual.split(",").map((x) => x.trim()).filter(Boolean);
    if (!ids.length) return;
    setSelected((s) => new Set([...s, ...ids]));
    setAvailable((a) => [...new Set([...(a || []), ...ids])]);
    setManual("");
  };

  const save = async () => {
    if (!isAnthropic && !form.name.trim()) return setError("Give the provider a name.");
    if (!isAnthropic && !form.baseURL.trim()) return setError("Base URL is required.");
    if (!isAnthropic && !selected.size) return setError("Pick at least one model.");
    const id = form.id || `p_${(form.preset || "custom").replace(/[^a-z0-9]/gi, "")}_${Date.now().toString(36)}`;
    const provider = {
      id,
      type: form.type,
      name: isAnthropic ? "Anthropic" : form.name.trim(),
      preset: form.preset,
      baseURL: form.baseURL.trim(),
      apiKey: form.apiKey,
      ...(isAnthropic ? {} : { models: [...selected] }),
      ...(isAnthropic ? {} : { modelPricing: Object.fromEntries([...selected].filter((m) => pricing[m]).map((m) => [m, pricing[m]])) }),
      ...(form.priceIn !== "" || form.priceOut !== "" ? { pricing: { input: Number(form.priceIn) || 0, output: Number(form.priceOut) || 0 } } : {}),
      ...(form.local ? { local: true } : {}),
    };
    const providers = config.providers.some((p) => p.id === id) ? config.providers.map((p) => (p.id === id ? provider : p)) : [...config.providers, provider];
    const patch = { providers };
    // Without a Claude key, make the first model of this provider the default.
    const anthropicReady = config.providers.find((p) => p.id === "anthropic")?.hasKey;
    const current = config.model.startsWith(`${id}::`);
    const stillListed = current && selected.has(config.model.slice(id.length + 2));
    if (!isAnthropic && ((!anthropicReady && !current) || (current && !stillListed))) {
      patch.model = modelKey(id, [...selected][0]);
    }
    await updateConfig(patch);
    toast(`${provider.name} saved`);
    onClose();
  };

  const shown = useMemo(() => (available || []).filter((m) => !q || m.toLowerCase().includes(q.toLowerCase())), [available, q]);

  if (step === "pick") {
    return (
      <Modal wide title="Add a model provider" icon={<Server size={20} />} onClose={onClose}>
        <div className="grid c4" style={{ gap: 10 }}>
          {presets.map((p) => (
            <button key={p.preset} className="preset" style={{ padding: 14 }} onClick={() => pick(p)}>
              <div className="row" style={{ gap: 10 }}>
                <Monogram name={p.name} size={30} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <b className="ellipsis" style={{ fontSize: 13.5, margin: 0 }}>{p.name}</b>
                  <span className="ellipsis" style={{ display: "block", fontSize: 11.5 }}>{p.local ? "Local" : "Cloud"}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
        <div className="section-title" style={{ margin: "8px 0 0" }}>Not in the list?</div>
        <div className="grid c2" style={{ gap: 10 }}>
          {CUSTOM.map((p) => (
            <button key={p.preset} className="preset" style={{ padding: 14 }} onClick={() => pick(p)}>
              <div className="row" style={{ gap: 10 }}>
                <span style={{ width: 30, height: 30, borderRadius: 7, display: "grid", placeItems: "center", border: "1px dashed var(--border-3)" }}><Plus size={15} /></span>
                <span>
                  <b style={{ fontSize: 13.5, margin: 0 }}>Custom provider</b>
                  <span style={{ display: "block", fontSize: 11.5 }}>{p.sub}</span>
                </span>
              </div>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      wide
      title={isAnthropic ? "Anthropic" : initial ? `Edit ${initial.name}` : form.custom ? "Custom provider" : form.name}
      icon={!initial ? <button className="icon-btn" onClick={() => setStep("pick")} title="Back"><ChevronLeft size={18} /></button> : <Monogram name={form.name || "?"} size={30} />}
      onClose={onClose}
      footer={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}><Check size={15} /> Save provider</button></>}
    >
      {!isAnthropic && (
        <div className="grid c2" style={{ gap: 12 }}>
          <label className="field">Name<input className="input" value={form.name} onChange={set("name")} placeholder="My provider" autoFocus={form.custom} /></label>
          <label className="field">
            API format
            <select className="select" value={form.type} onChange={set("type")} disabled={!form.custom && !initial}>
              <option value="openai">OpenAI-compatible (/chat/completions)</option>
              <option value="anthropic">Anthropic-compatible (/v1/messages)</option>
            </select>
          </label>
        </div>
      )}
      <label className="field">
        Base URL {isAnthropic && <span className="hint">Leave empty for api.anthropic.com</span>}
        <input className="input mono" value={form.baseURL} onChange={set("baseURL")} placeholder={form.type === "anthropic" ? "https://api.anthropic.com" : "https://api.example.com/v1"} />
      </label>
      <label className="field">
        <span className="row">
          API key
          {form.local && <span className="hint">Not needed for local servers</span>}
          {preset?.keyUrl && <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="small" style={{ marginLeft: "auto" }}>Get a key <ExternalLink size={11} /></a>}
          {isAnthropic && <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer" className="small" style={{ marginLeft: "auto" }}>Get a key <ExternalLink size={11} /></a>}
        </span>
        <div style={{ position: "relative" }}>
          <KeyRound size={14} style={{ position: "absolute", left: 11, top: 11, color: "var(--text-4)" }} />
          <input className="input mono" style={{ paddingLeft: 32 }} type="password" value={form.apiKey} onChange={set("apiKey")} placeholder={preset?.keyHint || (isAnthropic ? "sk-ant-…" : "API key")} />
        </div>
      </label>

      {isAnthropic ? (
        <div className="notice info">Claude models come from the built-in catalog with pricing and full feature support (thinking, caching, effort).</div>
      ) : (
        <>
          <div className="row" style={{ marginTop: 4 }}>
            <b className="grow">Models <span className="muted small">· {selected.size} selected</span></b>
            <button className="btn sm" onClick={loadModels} disabled={loading}>
              <RefreshCw size={13} className={loading ? "spinning" : ""} /> {available ? "Reload" : "Load models"}
            </button>
          </div>
          {error && <div className="notice error">{error}</div>}
          {available && available.length > 0 && (
            <div className="card" style={{ overflow: "hidden" }}>
              <div className="row" style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)" }}>
                <Search size={14} className="muted" />
                <input className="grow" style={{ background: "transparent", border: 0, outline: "none" }} placeholder={`Search ${available.length} models`} value={q} onChange={(e) => setQ(e.target.value)} />
                {selected.size > 0 && <button className="btn xs ghost" onClick={() => setSelected(new Set())}>Clear</button>}
              </div>
              <div style={{ maxHeight: 240, overflowY: "auto", padding: 4 }}>
                {shown.map((m) => (
                  <button key={m} className="menu-item" onClick={() => toggle(m)}>
                    <span style={{ width: 16, height: 16, borderRadius: 4, border: "1px solid var(--border-3)", display: "grid", placeItems: "center", background: selected.has(m) ? "var(--primary)" : "transparent", color: "var(--primary-ink)", flex: "none" }}>
                      {selected.has(m) && <Check size={12} strokeWidth={3} />}
                    </span>
                    <span className="mono ellipsis grow" style={{ fontSize: 12.5 }}>{m}</span>
                    {pricing[m] && <span className="sub mono">{pricing[m].input === 0 && pricing[m].output === 0 ? "free" : `${+pricing[m].input.toFixed(2)} / ${+pricing[m].output.toFixed(2)}`}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
          {!available && selected.size > 0 && (
            <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
              {[...selected].map((m) => (
                <span key={m} className="badge mono" style={{ cursor: "pointer" }} onClick={() => toggle(m)} title="Remove">{m} ×</span>
              ))}
            </div>
          )}
          <div className="row">
            <input className="input mono" value={manual} onChange={(e) => setManual(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addManual()} placeholder="Or type model ids, comma-separated" />
            <button className="btn" onClick={addManual}><Plus size={14} /> Add</button>
          </div>
          <div className="grid c2" style={{ gap: 12 }}>
            <label className="field">Input price <span className="hint">USD / 1M tokens, for models without published prices</span><input className="input mono" type="number" min="0" step="0.01" value={form.priceIn} onChange={set("priceIn")} placeholder="0" /></label>
            <label className="field">Output price <span className="hint">USD per 1M tokens</span><input className="input mono" type="number" min="0" step="0.01" value={form.priceOut} onChange={set("priceOut")} placeholder="0" /></label>
          </div>
        </>
      )}
    </Modal>
  );
}
