import { useEffect, useRef, useState } from "react";
import { Globe, KeyRound, Cpu, Shield, Palette, Wrench, Plus, Trash2, FolderOpen, Eye, EyeOff, Server } from "lucide-react";
import { useApp } from "../App.jsx";
import { Switch, Modal } from "../components/ui.jsx";
import { MODES } from "../components/Composer.jsx";
import { useWorkspacePicker } from "./ChatView.jsx";
import { ProvidersSection } from "../components/Providers.jsx";
import { modelGroups } from "../models.js";

const DEV_PRESSES = 10;

/** Ten Insert presses in a row (under 1.5s apart) unlock Dev-Mode. */
function useDevUnlock() {
  const { config, updateConfig, toast, setView } = useApp();
  const count = useRef(0);
  const last = useRef(0);
  useEffect(() => {
    const onKey = async (e) => {
      if (e.key !== "Insert") return;
      const now = Date.now();
      count.current = now - last.current < 1500 ? count.current + 1 : 1;
      last.current = now;
      const left = DEV_PRESSES - count.current;
      if (left > 0 && left <= 5) {
        toast(config.devMode ? "Dev-Mode is already on" : `${left} more ${left === 1 ? "press" : "presses"} to Dev-Mode`, "success", "dev-unlock");
      }
      if (left === 0) {
        count.current = 0;
        if (!config.devMode) {
          await updateConfig({ devMode: true });
          toast("Dev-Mode unlocked", "success", "dev-unlock");
        }
        setView("dev");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [config.devMode, updateConfig, toast, setView]);
}

export default function SettingsPage() {
  const { state, config, updateConfig, toast } = useApp();
  const { pick, modal } = useWorkspacePicker();
  useDevUnlock();

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 900 }}>
        <div className="page-head">
          <div>
            <h1>Settings</h1>
            <p>Stored in <code>{state.home}</code></p>
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 0 }}><KeyRound size={15} /> Model providers</div>
        <ProvidersSection />

        <div className="section-title"><Globe size={15} /> Network</div>
        <div className="card">
          <ProxySetting />
        </div>

        <div className="section-title"><Cpu size={15} /> Model</div>
        <div className="card">
          <Setting title="Default model" desc="Used for new sessions. Change per session from the composer.">
            <select className="select" value={config.model} onChange={(e) => updateConfig({ model: e.target.value })}>
              {modelGroups(state, config).map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {g.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </optgroup>
              ))}
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
          <Setting title="Tab autocomplete (IDE)" desc="Ghost-text suggestions while you type. Tab accepts, Ctrl+→ accepts one word, Esc dismisses.">
            <Switch on={config.completionEnabled !== false} onChange={(v) => updateConfig({ completionEnabled: v })} />
          </Setting>
          <Setting title="Autocomplete model" desc="Use a fast, cheap model — completions fire on every pause while typing.">
            <select className="select" value={config.completionModel || ""} onChange={(e) => updateConfig({ completionModel: e.target.value })}>
              <option value="">Auto (Haiku 5.5 with an Anthropic key, else default model)</option>
              {modelGroups(state, config).map((g) => (
                <optgroup key={g.id} label={g.name}>
                  {g.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </optgroup>
              ))}
            </select>
          </Setting>
          <Setting title="Auto-compact context" desc="Other providers: Fish summarizes older turns once the context passes this size. Claude models: the API compacts at its own threshold (~150k). Off disables both.">
            <select className="select" value={String(config.autoCompactTokens ?? 150000)} onChange={(e) => updateConfig({ autoCompactTokens: Number(e.target.value) })}>
              <option value="0">Off</option>
              <option value="100000">100k tokens</option>
              <option value="150000">150k tokens</option>
              <option value="300000">300k tokens</option>
              <option value="600000">600k tokens</option>
            </select>
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

function ProxySetting() {
  const { state, config, updateConfig, refreshState, toast } = useApp();
  const [value, setValue] = useState(config.proxy || "");
  const net = state.network || { mode: "direct" };
  const save = async () => {
    await updateConfig({ proxy: value.trim() });
    await refreshState();
    toast(value.trim() ? "Proxy saved" : "Using system proxy settings");
  };
  return (
    <div className="setting" style={{ alignItems: "flex-start" }}>
      <div className="txt">
        <b>Proxy</b>
        <span>
          {net.mode === "manual" ? `Using ${net.url}` : net.mode === "system" ? `Using system proxy ${net.url}` : "Direct connection."} Set one if a provider blocks your region (HTTP 403).
        </span>
        <div className="row" style={{ marginTop: 10 }}>
          <input className="input mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder="http://127.0.0.1:10809 — empty = system" onKeyDown={(e) => e.key === "Enter" && save()} />
          <button className="btn" disabled={value.trim() === (config.proxy || "")} onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
