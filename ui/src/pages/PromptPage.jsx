import { useEffect, useState } from "react";
import { Check, ScrollText, Eye, PenLine, Save, RotateCcw } from "lucide-react";
import { useApp } from "../App.jsx";
import { api, fmt } from "../api.js";
import CodeEditor from "../components/CodeEditor.jsx";

export default function PromptPage() {
  const { state, config, updateConfig, toast } = useApp();
  const [custom, setCustom] = useState(config.customPrompt || "");
  const [append, setAppend] = useState(config.appendPrompt || "");
  const [preview, setPreview] = useState("");
  const [tab, setTab] = useState("edit");

  const loadPreview = () => api(`/system-prompt`).then((r) => setPreview(r.text));
  useEffect(() => {
    loadPreview();
  }, [config.promptPreset, config.customPrompt, config.appendPrompt, config.permissionMode]);

  const preset = state.presets.find((p) => p.id === config.promptPreset);
  const dirty = custom !== (config.customPrompt || "") || append !== (config.appendPrompt || "");

  const save = async () => {
    await updateConfig({ customPrompt: custom, appendPrompt: append });
    toast("System prompt saved");
  };

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>System prompt</h1>
            <p>Shape Fish's personality and rules. Skills, environment and project files (FISH.md, AGENTS.md, CLAUDE.md) are added automatically.</p>
          </div>
          <div className="actions">
            <button className="btn primary" disabled={!dirty} onClick={save}><Save size={15} /> Save</button>
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 0 }}>Base persona</div>
        <div className="grid c3">
          {[...state.presets, { id: "custom", name: "Custom", description: "Write your own prompt from scratch." }].map((p) => (
            <button key={p.id} className={`preset ${config.promptPreset === p.id ? "on" : ""}`} onClick={() => updateConfig({ promptPreset: p.id })}>
              {config.promptPreset === p.id && <Check size={17} className="tick" />}
              <b>{p.name}</b>
              <span>{p.description}</span>
            </button>
          ))}
        </div>

        <div className="row" style={{ margin: "28px 0 12px" }}>
          <div className="section-title" style={{ margin: 0 }}>{config.promptPreset === "custom" ? "Custom prompt" : `${preset?.name} prompt`}</div>
          <div className="grow" />
          <div className="seg">
            <button className={tab === "edit" ? "on" : ""} onClick={() => setTab("edit")}><PenLine size={13} /> Edit</button>
            <button className={tab === "preview" ? "on" : ""} onClick={() => (loadPreview(), setTab("preview"))}><Eye size={13} /> Full preview</button>
          </div>
        </div>

        {tab === "edit" ? (
          <div className="col" style={{ gap: 16 }}>
            <div className="card" style={{ overflow: "hidden" }}>
              {config.promptPreset === "custom" ? (
                <CodeEditor file="prompt.md" value={custom} onChange={setCustom} height="320px" onSave={save} />
              ) : (
                <div style={{ position: "relative" }}>
                  <CodeEditor file="prompt.md" value={preset?.text || ""} readOnly height="260px" />
                  <div className="row" style={{ padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
                    <span className="small muted grow">Presets are read-only. Start a custom prompt from this one to edit it.</span>
                    <button className="btn sm" onClick={async () => { setCustom(preset.text); await updateConfig({ promptPreset: "custom", customPrompt: preset.text }); }}>
                      <RotateCcw size={13} /> Customize this preset
                    </button>
                  </div>
                </div>
              )}
            </div>
            <label className="field">
              Always append <span className="hint">Extra rules added to every session, whatever the persona — e.g. "Answer in Russian", "Use pnpm".</span>
              <textarea className="textarea" rows={4} value={append} onChange={(e) => setAppend(e.target.value)} placeholder="Always reply in Russian. Prefer TypeScript…" />
            </label>
          </div>
        ) : (
          <div className="card" style={{ overflow: "hidden" }}>
            <div className="row small muted" style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)" }}>
              <ScrollText size={14} /> Assembled for <code>{config.workspace}</code>
              <span className="grow" />≈ {fmt.tokens(preview.length / 4)} tokens
            </div>
            <CodeEditor file="system.md" value={preview} readOnly height="460px" />
          </div>
        )}
      </div>
    </div>
  );
}
