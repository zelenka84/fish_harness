import { useEffect, useRef, useState } from "react";
import { ArrowUp, Square, Cpu, Gauge, ShieldQuestion, ShieldCheck, Zap, Map as MapIcon, Check, Sparkles, FolderOpen } from "lucide-react";
import { Popover, useDropdown } from "./ui.jsx";
import { useApp } from "../App.jsx";
import { api, basename } from "../api.js";

export const MODES = [
  { id: "ask", label: "Ask before edits", short: "Ask", icon: ShieldQuestion, sub: "Approve every edit and command" },
  { id: "auto-edit", label: "Auto-accept edits", short: "Auto-edit", icon: ShieldCheck, sub: "Edits apply; commands still ask" },
  { id: "plan", label: "Plan mode", short: "Plan", icon: MapIcon, sub: "Read-only research, then a plan" },
  { id: "yolo", label: "Full auto", short: "YOLO", icon: Zap, sub: "Never asks. Use with care" },
];

const EFFORT_SUB = { low: "Fastest, cheapest", medium: "Balanced", high: "Thorough (recommended)", xhigh: "Deep agentic work", max: "Maximum quality" };

export default function Composer({ onSend, running, onStop, model, onModel, workspace, onWorkspace, compact, autoFocus = true }) {
  const { state, config, updateConfig } = useApp();
  const [text, setText] = useState("");
  const [skills, setSkills] = useState([]);
  const [slashIdx, setSlashIdx] = useState(0);
  const ta = useRef(null);
  const modelDd = useDropdown();
  const effortDd = useDropdown();
  const modeDd = useDropdown();

  useEffect(() => {
    api("/skills").then(setSkills).catch(() => {});
  }, []);
  useEffect(() => {
    if (autoFocus) ta.current?.focus();
  }, [autoFocus]);
  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 280) + "px";
  }, [text]);

  const slash = /^\/([\w-]*)$/.exec(text);
  const slashItems = slash ? skills.filter((s) => s.enabled && s.name.includes(slash[1])).slice(0, 7) : [];

  const submit = () => {
    const t = text.trim();
    if (!t || running) return;
    onSend(t);
    setText("");
  };
  const pickSkill = (s) => {
    setText(`Use the ${s.name} skill: `);
    ta.current?.focus();
  };

  const allModels = [
    ...state.models,
    ...config.providers.filter((p) => p.type === "openai").flatMap((p) => (p.models || []).map((id) => ({ id, label: id, tier: p.name, custom: true }))),
  ];
  const current = allModels.find((m) => m.id === model) || { id: model, label: model };
  const mode = MODES.find((m) => m.id === config.permissionMode) || MODES[0];

  return (
    <div className="composer-wrap">
      <div className="composer">
        {slashItems.length > 0 && (
          <div className="popover" style={{ bottom: "calc(100% + 8px)", left: 0, width: 360 }}>
            <div className="menu-label">Skills</div>
            {slashItems.map((s, i) => (
              <button key={s.name} className={`menu-item ${i === slashIdx ? "hl" : ""}`} onMouseDown={(e) => (e.preventDefault(), pickSkill(s))}>
                <Sparkles size={15} style={{ color: "var(--accent)" }} />
                <span className="grow">
                  <div>/{s.name}</div>
                  <div className="sub ellipsis">{s.description}</div>
                </span>
              </button>
            ))}
          </div>
        )}
        <textarea
          ref={ta}
          rows={1}
          value={text}
          placeholder={running ? "Fish is working — you can type your next message…" : "Ask Fish to build, fix, or explain anything…  ( / for skills )"}
          onChange={(e) => {
            setText(e.target.value);
            setSlashIdx(0);
          }}
          onKeyDown={(e) => {
            if (slashItems.length) {
              if (e.key === "ArrowDown") return e.preventDefault(), setSlashIdx((i) => (i + 1) % slashItems.length);
              if (e.key === "ArrowUp") return e.preventDefault(), setSlashIdx((i) => (i - 1 + slashItems.length) % slashItems.length);
              if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), pickSkill(slashItems[slashIdx]);
            }
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-bar">
          <div style={{ position: "relative" }}>
            <button ref={modelDd.anchor} className="pill" onClick={modelDd.toggle}>
              <Cpu size={14} /> {current.label}
            </button>
            <Popover anchor={modelDd.anchor} open={modelDd.open} onClose={modelDd.close} style={{ width: 300 }}>
              <div className="menu-label">Model</div>
              {allModels.map((m) => (
                <button key={m.id} className="menu-item" onClick={() => (onModel(m.id), modelDd.close())}>
                  <span className="grow">
                    <div>{m.label}</div>
                    <div className="sub">{m.custom ? m.tier : `${m.tier} · $${m.input}/$${m.output} per MTok`}</div>
                  </span>
                  {m.id === model && <Check size={15} className="check" />}
                </button>
              ))}
            </Popover>
          </div>

          <div style={{ position: "relative" }}>
            <button ref={effortDd.anchor} className="pill" onClick={effortDd.toggle} title="Reasoning effort">
              <Gauge size={14} /> {config.effort}
            </button>
            <Popover anchor={effortDd.anchor} open={effortDd.open} onClose={effortDd.close} style={{ width: 240 }}>
              <div className="menu-label">Effort</div>
              {state.efforts.map((e) => (
                <button key={e} className="menu-item" onClick={() => (updateConfig({ effort: e }), effortDd.close())}>
                  <span className="grow">
                    <div style={{ textTransform: "capitalize" }}>{e}</div>
                    <div className="sub">{EFFORT_SUB[e]}</div>
                  </span>
                  {e === config.effort && <Check size={15} className="check" />}
                </button>
              ))}
            </Popover>
          </div>

          <div style={{ position: "relative" }}>
            <button ref={modeDd.anchor} className={`pill mode-${mode.id}`} onClick={modeDd.toggle}>
              <mode.icon size={14} /> {compact ? mode.short : mode.label}
            </button>
            <Popover anchor={modeDd.anchor} open={modeDd.open} onClose={modeDd.close} style={{ width: 280 }}>
              <div className="menu-label">Permissions</div>
              {MODES.map((m) => (
                <button key={m.id} className="menu-item" onClick={() => (updateConfig({ permissionMode: m.id }), modeDd.close())}>
                  <m.icon size={16} />
                  <span className="grow">
                    <div>{m.label}</div>
                    <div className="sub">{m.sub}</div>
                  </span>
                  {m.id === config.permissionMode && <Check size={15} className="check" />}
                </button>
              ))}
            </Popover>
          </div>

          {!compact && workspace && (
            <button className="pill" onClick={onWorkspace} title={workspace}>
              <FolderOpen size={14} /> {basename(workspace)}
            </button>
          )}

          {running ? (
            <button className="send stop" onClick={onStop} title="Stop (Esc)">
              <Square size={13} fill="currentColor" />
            </button>
          ) : (
            <button className="send" disabled={!text.trim()} onClick={submit} title="Send (Enter)">
              <ArrowUp size={18} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      {!compact && (
        <div className="composer-foot">
          <span>Enter to send · Shift+Enter for newline · / for skills</span>
          <span>Fish can make mistakes — review changes before shipping.</span>
        </div>
      )}
    </div>
  );
}
