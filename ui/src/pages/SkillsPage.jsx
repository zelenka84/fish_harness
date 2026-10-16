import { useEffect, useState } from "react";
import { Sparkles, Plus, Trash2, Lock, FolderGit2, Search } from "lucide-react";
import { useApp } from "../App.jsx";
import { api } from "../api.js";
import { Modal, Switch } from "../components/ui.jsx";
import CodeEditor from "../components/CodeEditor.jsx";

const SOURCE = {
  fish: { label: "Fish", cls: "accent" },
  claude: { label: "Claude Code", cls: "violet" },
  project: { label: "Project", cls: "good" },
};

const TEMPLATE = `---
name: my-skill
description: One sentence on when Fish should use this skill.
---

# My skill

Step-by-step instructions Fish follows when this skill is loaded.

1. …
2. …
`;

export default function SkillsPage() {
  const { toast, state } = useApp();
  const [skills, setSkills] = useState(null);
  const [editing, setEditing] = useState(null); // { name?, content, editable }
  const [q, setQ] = useState("");

  const load = () => api("/skills").then(setSkills).catch((e) => toast(e.message, "error"));
  useEffect(() => {
    load();
  }, []);

  const open = async (s) => {
    const full = await api(`/skills/${encodeURIComponent(s.name)}`);
    setEditing({ name: s.name, content: full.content, editable: s.editable, source: s.source, dir: s.dir });
  };
  const toggle = async (s, e) => {
    e?.stopPropagation();
    setSkills(await api(`/skills/${encodeURIComponent(s.name)}/toggle`, { method: "POST" }));
  };
  const save = async () => {
    const nameMatch = /^name:\s*(.+)$/m.exec(editing.content);
    const name = nameMatch?.[1]?.trim() || editing.name || "my-skill";
    await api("/skills", { method: "POST", body: { name, content: editing.content } });
    toast(`Skill "${name}" saved`);
    setEditing(null);
    load();
  };
  const remove = async () => {
    if (!confirm(`Delete skill "${editing.name}"?`)) return;
    await api(`/skills/${encodeURIComponent(editing.name)}`, { method: "DELETE" });
    toast("Skill deleted");
    setEditing(null);
    load();
  };

  const list = (skills || []).filter((s) => !q || (s.name + s.description).toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Skills</h1>
            <p>Packaged instructions Fish loads on demand. Type <kbd>/</kbd> in the composer to use one.</p>
          </div>
          <div className="actions">
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", left: 11, top: 10, color: "var(--text-4)" }} />
              <input className="input" style={{ paddingLeft: 32, height: 34, width: 220 }} placeholder="Search skills" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <button className="btn primary" onClick={() => setEditing({ content: TEMPLATE, editable: true, isNew: true })}>
              <Plus size={16} /> New skill
            </button>
          </div>
        </div>

        <div className="grid c3">
          {list.map((s) => (
            <div key={s.name} className="card hover skill-card" onClick={() => open(s)}>
              <div className="row">
                <div className="skill-glyph"><Sparkles size={17} /></div>
                <div className="grow">
                  <div style={{ fontWeight: 640 }} className="ellipsis">{s.name}</div>
                  <span className={`badge ${SOURCE[s.source]?.cls}`}>{SOURCE[s.source]?.label}</span>
                </div>
                <span onClick={(e) => e.stopPropagation()}>
                  <Switch on={s.enabled} onChange={() => toggle(s)} label={`Enable ${s.name}`} />
                </span>
              </div>
              <div className="desc">{s.description}</div>
              <div className="row small muted">
                {s.editable ? <FolderGit2 size={12} /> : <Lock size={12} />}
                <span className="ellipsis">{s.editable ? "Editable" : "Read-only"} · {(s.size / 1024).toFixed(1)} KB</span>
              </div>
            </div>
          ))}
        </div>
        {skills && !list.length && (
          <div className="empty">
            <Sparkles size={26} />
            <b style={{ color: "var(--text)" }}>No skills found</b>
            Create one, or drop folders with a SKILL.md into <code>{state.home}\skills</code>
          </div>
        )}

        <div className="section-title">Where skills come from</div>
        <div className="card">
          <div className="list-item"><span className="badge accent">Fish</span><span className="small muted mono">{state.home}\skills\&lt;name&gt;\SKILL.md</span></div>
          <div className="list-item"><span className="badge good">Project</span><span className="small muted mono">&lt;workspace&gt;\.fish\skills · &lt;workspace&gt;\.claude\skills</span></div>
          <div className="list-item"><span className="badge violet">Claude Code</span><span className="small muted mono">~\.claude\skills (shared, read-only)</span></div>
        </div>
      </div>

      {editing && (
        <Modal
          wide
          title={editing.isNew ? "New skill" : editing.name}
          icon={<div className="skill-glyph"><Sparkles size={17} /></div>}
          onClose={() => setEditing(null)}
          footer={
            <>
              {!editing.isNew && editing.editable && (
                <button className="btn danger" style={{ marginRight: "auto" }} onClick={remove}><Trash2 size={15} /> Delete</button>
              )}
              <button className="btn ghost" onClick={() => setEditing(null)}>Close</button>
              {editing.editable && <button className="btn primary" onClick={save}>Save skill</button>}
            </>
          }
        >
          {!editing.editable && <div className="notice info"><Lock size={15} /> This skill lives in {editing.dir} and is read-only here.</div>}
          <div style={{ border: "1px solid var(--border-2)", borderRadius: 12, overflow: "hidden", background: "var(--bg-2)" }}>
            <CodeEditor file="SKILL.md" value={editing.content} readOnly={!editing.editable} height="420px" onChange={(v) => setEditing((e) => ({ ...e, content: v }))} onSave={editing.editable ? save : undefined} />
          </div>
          <span className="small muted">The frontmatter <code>name</code> and <code>description</code> tell Fish when to load the skill. Keep the description specific.</span>
        </Modal>
      )}
    </div>
  );
}
