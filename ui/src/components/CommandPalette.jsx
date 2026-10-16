import { useMemo, useState } from "react";
import { Plus, MessageSquare, Sun, Cpu, Shield, CornerDownLeft } from "lucide-react";
import { useApp, VIEWS } from "../App.jsx";
import { MODES } from "./Composer.jsx";
import { fmt } from "../api.js";

export default function CommandPalette({ onClose }) {
  const { sessions, openSession, newSession, setView, updateConfig, config, state } = useApp();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  const items = useMemo(() => {
    const all = [
      { group: "Actions", icon: Plus, label: "New session", hint: "Ctrl N", run: () => newSession() },
      ...VIEWS.map((v) => ({ group: "Go to", icon: v.icon, label: v.label, hint: `Ctrl ${v.key}`, run: () => setView(v.id) })),
      { group: "Go to", icon: Shield, label: "Settings", run: () => setView("settings") },
      { group: "Go to", icon: Shield, label: "Accounts", run: () => setView("accounts") },
      { group: "Actions", icon: Sun, label: `Switch to ${config.theme === "dark" ? "light" : "dark"} theme`, run: () => updateConfig({ theme: config.theme === "dark" ? "light" : "dark" }) },
      ...state.models.map((m) => ({ group: "Default model", icon: Cpu, label: `Use ${m.label}`, run: () => updateConfig({ model: m.id }) })),
      ...MODES.map((m) => ({ group: "Permissions", icon: m.icon, label: m.label, run: () => updateConfig({ permissionMode: m.id }) })),
      ...sessions.map((s) => ({ group: "Sessions", icon: MessageSquare, label: s.title, hint: fmt.ago(s.updatedAt), run: () => openSession(s.id) })),
    ];
    const needle = q.toLowerCase();
    return all.filter((i) => !needle || i.label.toLowerCase().includes(needle) || i.group.toLowerCase().includes(needle)).slice(0, 40);
  }, [q, sessions, config, state]);

  const run = (item) => {
    item.run();
    onClose();
  };

  let lastGroup = null;
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{ placeItems: "start center" }}>
      <div className="palette">
        <input
          autoFocus
          placeholder="Type a command or search sessions…"
          value={q}
          onChange={(e) => (setQ(e.target.value), setIdx(0))}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") (e.preventDefault(), setIdx((i) => Math.min(items.length - 1, i + 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)));
            if (e.key === "Enter" && items[idx]) run(items[idx]);
          }}
        />
        <div className="results">
          {items.length === 0 && <div className="muted small" style={{ padding: 16 }}>Nothing found.</div>}
          {items.map((it, i) => {
            const header = it.group !== lastGroup ? <div className="menu-label">{it.group}</div> : null;
            lastGroup = it.group;
            return (
              <div key={it.group + it.label + i}>
                {header}
                <button className={`menu-item ${i === idx ? "hl" : ""}`} onMouseEnter={() => setIdx(i)} onClick={() => run(it)}>
                  <it.icon size={16} />
                  <span className="grow ellipsis">{it.label}</span>
                  {it.hint && <span className="sub">{it.hint}</span>}
                  {i === idx && <CornerDownLeft size={13} className="sub" />}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
