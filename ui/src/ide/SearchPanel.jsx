import { useEffect, useRef, useState } from "react";
import { CaseSensitive, Regex, ChevronRight } from "lucide-react";
import { api } from "../api.js";
import { FileIcon } from "./icons.jsx";

export default function SearchPanel({ ws, onOpenAt, focusKey }) {
  const [query, setQuery] = useState("");
  const [glob, setGlob] = useState("");
  const [caseSens, setCase] = useState(false);
  const [regex, setRegex] = useState(false);
  const [res, setRes] = useState(null);
  const [error, setError] = useState("");
  const [collapsed, setCollapsed] = useState(() => new Set());
  const input = useRef(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, [focusKey]);

  useEffect(() => {
    if (!query.trim()) return setRes(null);
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ workspace: ws, q: query, case: caseSens ? "1" : "0", regex: regex ? "1" : "0" });
        if (glob.trim()) params.set("glob", glob.trim());
        setRes(await api(`/fs/search?${params}`));
        setError("");
      } catch (e) {
        setError(e.message);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [query, glob, caseSens, regex, ws]);

  return (
    <div className="side-panel">
      <div className="panel-head"><span className="grow">Search</span></div>
      <div className="col" style={{ padding: 10, gap: 6 }}>
        <div className="search-box">
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search in files" />
          <button className={`toggle ${caseSens ? "on" : ""}`} title="Match case" onClick={() => setCase((v) => !v)}><CaseSensitive size={15} /></button>
          <button className={`toggle ${regex ? "on" : ""}`} title="Regular expression" onClick={() => setRegex((v) => !v)}><Regex size={14} /></button>
        </div>
        <input className="input mono" style={{ height: 30, fontSize: 12 }} value={glob} onChange={(e) => setGlob(e.target.value)} placeholder="files to include, e.g. src/**/*.ts" />
        {error && <div className="small" style={{ color: "var(--bad)" }}>{error}</div>}
        {res && <div className="small muted">{res.total} results in {res.results.length} files{res.capped && " (capped)"}</div>}
      </div>
      <div className="tree" style={{ paddingTop: 0 }}>
        {res?.results.map((f) => {
          const isOpen = !collapsed.has(f.path);
          return (
            <div key={f.path}>
              <button className="tree-row" onClick={() => setCollapsed((s) => { const n = new Set(s); n.has(f.path) ? n.delete(f.path) : n.add(f.path); return n; })}>
                <ChevronRight size={14} className={`chev ${isOpen ? "open" : ""}`} />
                <FileIcon name={f.path} />
                <span className="ellipsis name">{f.path.split("/").pop()}</span>
                <span className="ellipsis muted" style={{ fontSize: 11 }}>{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
                <span className="count-pill">{f.matches.length}</span>
              </button>
              {isOpen &&
                f.matches.map((m, i) => {
                  const start = Math.max(0, m.col - 1 - 30);
                  const before = m.text.slice(start, m.col - 1);
                  const hit = m.text.slice(m.col - 1, m.col - 1 + m.len);
                  const after = m.text.slice(m.col - 1 + m.len, m.col - 1 + m.len + 80);
                  return (
                    <button key={i} className="tree-row match-row" style={{ paddingLeft: 36 }} onClick={() => onOpenAt(f.path, m.line, m.col, m.len)} title={`Line ${m.line}`}>
                      <span className="ellipsis mono">
                        {start > 0 && "…"}{before.trimStart()}<mark>{hit}</mark>{after}
                      </span>
                      <span className="muted" style={{ marginLeft: "auto", fontSize: 10.5 }}>{m.line}</span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
