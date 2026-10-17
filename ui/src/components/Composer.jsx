import { useEffect, useRef, useState } from "react";
import { Paperclip, X, FileText, FileCode2, Plus, ArrowUp, Square, Cpu, Gauge, ShieldQuestion, ShieldCheck, Zap, Map as MapIcon, Check, Sparkles, FolderOpen } from "lucide-react";
import { Popover, useDropdown } from "./ui.jsx";
import { useApp } from "../App.jsx";
import { api, basename } from "../api.js";
import { modelGroups, modelLabel } from "../models.js";
import { onDraft } from "../agentStore.js";
import { readAttachment, toContent, formatSize } from "../attachments.js";

export const MODES = [
  { id: "ask", label: "Ask before edits", short: "Ask", icon: ShieldQuestion, sub: "Approve every edit and command" },
  { id: "auto-edit", label: "Auto-accept edits", short: "Auto-edit", icon: ShieldCheck, sub: "Edits apply; commands still ask" },
  { id: "plan", label: "Plan mode", short: "Plan", icon: MapIcon, sub: "Read-only research, then a plan" },
  { id: "yolo", label: "Full auto", short: "YOLO", icon: Zap, sub: "Never asks. Use with care" },
];

const EFFORT_SUB = { low: "Fastest, cheapest", medium: "Balanced", high: "Thorough (recommended)", xhigh: "Deep agentic work", max: "Maximum quality" };

export default function Composer({ onSend, running, onStop, model, onModel, workspace, onWorkspace, compact, autoFocus = true }) {
  const { state, config, updateConfig, setView, toast } = useApp();
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileInput = useRef(null);
  const dragDepth = useRef(0);

  const addFiles = async (files) => {
    for (const file of files) {
      try {
        const a = await readAttachment(file);
        setAttachments((list) => (list.length >= 20 ? list : [...list, a]));
      } catch (e) {
        toast(e.message, "error");
      }
    }
    ta.current?.focus();
  };
  const [skills, setSkills] = useState([]);
  const [slashIdx, setSlashIdx] = useState(0);
  const ta = useRef(null);
  const modelDd = useDropdown();
  const effortDd = useDropdown();
  const modeDd = useDropdown();

  useEffect(() => {
    api("/skills").then(setSkills).catch(() => {});
  }, []);
  useEffect(
    () =>
      onDraft((t) => {
        setText((cur) => (cur.trim() ? `${cur.trimEnd()}

${t}` : t));
        setTimeout(() => ta.current?.focus(), 0);
      }),
    [],
  );
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
    if ((!t && !attachments.length) || running) return;
    onSend(toContent(t, attachments));
    setText("");
    setAttachments([]);
  };
  const pickSkill = (s) => {
    setText(`Use the ${s.name} skill: `);
    ta.current?.focus();
  };

  const groups = modelGroups(state, config);
  const currentLabel = modelLabel(state, config, model);
  const mode = MODES.find((m) => m.id === config.permissionMode) || MODES[0];

  return (
    <div className="composer-wrap">
      <div
        className={`composer ${dragging ? "dragging" : ""}`}
        onDragEnter={(e) => {
          if (![...e.dataTransfer.types].includes("Files")) return;
          e.preventDefault();
          dragDepth.current++;
          setDragging(true);
        }}
        onDragOver={(e) => [...e.dataTransfer.types].includes("Files") && e.preventDefault()}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (!dragDepth.current) setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          addFiles([...e.dataTransfer.files]);
        }}
      >
        {dragging && <div className="drop-hint"><Paperclip size={16} /> Drop images, PDFs or code files</div>}
        {attachments.length > 0 && (
          <div className="attach-tray">
            {attachments.map((a) =>
              a.kind === "image" ? (
                <div key={a.id} className="attach-thumb" title={`${a.name} · ${formatSize(a.size)}`} onClick={() => setPreview(a.preview)}>
                  <img src={a.preview} alt={a.name} />
                  <button className="attach-x" onClick={(e) => (e.stopPropagation(), setAttachments((l) => l.filter((x) => x.id !== a.id)))}><X size={11} /></button>
                </div>
              ) : (
                <div key={a.id} className="attach-chip" title={a.name}>
                  {a.kind === "pdf" ? <FileText size={15} /> : <FileCode2 size={15} />}
                  <span className="ellipsis">{a.name}</span>
                  <span className="sub">{a.kind === "pdf" ? "PDF" : formatSize(a.size)}</span>
                  <button className="attach-x static" onClick={() => setAttachments((l) => l.filter((x) => x.id !== a.id))}><X size={11} /></button>
                </div>
              ),
            )}
          </div>
        )}
        {preview && (
          <div className="overlay" onClick={() => setPreview(null)}>
            <img src={preview} alt="" className="lightbox" />
          </div>
        )}
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
          onPaste={(e) => {
            const files = [...(e.clipboardData?.files || [])];
            if (!files.length) return;
            // Office/Excel put both text and an image on the clipboard: keep the text.
            if (e.clipboardData.getData("text/plain")) return;
            e.preventDefault();
            addFiles(files);
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
          <button className="pill icon-only" title="Attach images, PDFs or files (or paste / drop them)" onClick={() => fileInput.current?.click()}>
            <Paperclip size={15} />
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            accept="image/*,application/pdf,text/*,.md,.json,.yaml,.yml,.toml,.csv,.js,.jsx,.ts,.tsx,.py,.go,.rs,.java,.kt,.c,.cpp,.h,.cs,.php,.rb,.swift,.lua,.luau,.sh,.ps1,.sql,.html,.css,.vue,.svelte,.xml,.log"
            onChange={(e) => {
              addFiles([...e.target.files]);
              e.target.value = "";
            }}
          />
          <div style={{ position: "relative" }}>
            <button ref={modelDd.anchor} className="pill" onClick={modelDd.toggle}>
              <Cpu size={14} /> <span className="ellipsis" style={{ maxWidth: 220 }}>{currentLabel}</span>
            </button>
            <Popover anchor={modelDd.anchor} open={modelDd.open} onClose={modelDd.close} style={{ width: 320, maxHeight: 420, overflowY: "auto" }}>
              {groups.map((g) => (
                <div key={g.id}>
                  <div className="menu-label">{g.name}{!g.ready && " · no key"}</div>
                  {g.models.map((m) => (
                    <button key={m.id} className="menu-item" onClick={() => (onModel(m.id), modelDd.close())}>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <div className="ellipsis">{m.label}</div>
                        {g.id === "anthropic" && <div className="sub">{m.sub}</div>}
                      </span>
                      {m.id === model && <Check size={15} className="check" />}
                    </button>
                  ))}
                </div>
              ))}
              <div style={{ borderTop: "1px solid var(--border)", margin: "4px 0" }} />
              <button className="menu-item" onClick={() => (modelDd.close(), setView("settings"))}>
                <Plus size={15} /> <span className="grow">Add a provider…</span>
              </button>
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
            <button className="send" disabled={!text.trim() && !attachments.length} onClick={submit} title="Send (Enter)">
              <ArrowUp size={18} strokeWidth={2.4} />
            </button>
          )}
        </div>
      </div>
      {!compact && (
        <div className="composer-foot">
          <span>Enter to send · Shift+Enter for newline · / for skills · paste or drop files</span>
          <span>Fish can make mistakes — review changes before shipping.</span>
        </div>
      )}
    </div>
  );
}
