import { useState } from "react";
import { GitBranch, Plus, Minus, Undo2, Check, RefreshCw, Sparkles, ArrowUp, ArrowDown } from "lucide-react";
import { api } from "../api.js";
import { useApp } from "../App.jsx";
import { FileIcon } from "./icons.jsx";

const STATUS = { M: "Modified", A: "Added", D: "Deleted", R: "Renamed", U: "Untracked", C: "Copied", "?": "Untracked" };

export default function GitPanel({ ws, git, refresh, onOpenDiff, onAskAgent }) {
  const { toast } = useApp();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const call = async (path, body, okText) => {
    setBusy(true);
    try {
      const r = await api(path, { method: "POST", body: { workspace: ws, ...body } });
      if (okText) toast(okText);
      await refresh();
      return r;
    } catch (e) {
      toast(e.message, "error");
    } finally {
      setBusy(false);
    }
  };

  if (!git) return <div className="side-panel"><div className="panel-head">Source control</div></div>;
  if (!git.repo) {
    return (
      <div className="side-panel">
        <div className="panel-head"><span className="grow">Source control</span></div>
        <div className="col" style={{ padding: 14, gap: 10 }}>
          <span className="small muted">This folder is not a git repository.</span>
          <button className="btn sm primary" onClick={() => call("/git/init", {}, "Repository initialized")}>Initialize repository</button>
        </div>
      </div>
    );
  }

  const commit = async () => {
    if (!message.trim()) return toast("Write a commit message first", "error");
    if (!git.staged.length) {
      if (!git.unstaged.length) return toast("Nothing to commit", "error");
      await call("/git/stage", { paths: [] });
    }
    const r = await call("/git/commit", { message }, "Committed");
    if (r) setMessage("");
  };

  const Row = ({ f, staged }) => (
    <div className="tree-row git-row" onClick={() => onOpenDiff(f.path)} title={`${STATUS[f.status] || f.status} — click to view diff`}>
      <FileIcon name={f.path} />
      <span className="ellipsis name">{f.path.split("/").pop()}</span>
      <span className="ellipsis muted" style={{ fontSize: 11 }}>{f.path.includes("/") ? f.path.slice(0, f.path.lastIndexOf("/")) : ""}</span>
      <span className="row-actions" onClick={(e) => e.stopPropagation()}>
        {staged ? (
          <button className="icon-btn sm" title="Unstage" onClick={() => call("/git/unstage", { paths: [f.path] })}><Minus size={13} /></button>
        ) : (
          <>
            <button className="icon-btn sm" title="Discard changes" onClick={() => confirm(`Discard changes to ${f.path}? This cannot be undone.`) && call("/git/discard", { paths: [f.path] })}><Undo2 size={13} /></button>
            <button className="icon-btn sm" title="Stage" onClick={() => call("/git/stage", { paths: [f.path] })}><Plus size={13} /></button>
          </>
        )}
      </span>
      <span className={`git-letter s-${f.status === "?" ? "U" : f.status}`}>{f.status === "?" ? "U" : f.status}</span>
    </div>
  );

  return (
    <div className="side-panel">
      <div className="panel-head">
        <span className="grow row" style={{ gap: 6 }}><GitBranch size={13} /> {git.branch}</span>
        {git.ahead > 0 && <span className="small muted row" style={{ gap: 2 }}><ArrowUp size={12} />{git.ahead}</span>}
        {git.behind > 0 && <span className="small muted row" style={{ gap: 2 }}><ArrowDown size={12} />{git.behind}</span>}
        <button className="icon-btn sm" title="Refresh" onClick={refresh}><RefreshCw size={13} /></button>
      </div>
      <div className="col" style={{ padding: 10, gap: 8 }}>
        <textarea
          className="textarea"
          style={{ minHeight: 64, fontFamily: "var(--font)", fontSize: 13 }}
          placeholder="Commit message (Ctrl+Enter to commit)"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.ctrlKey || e.metaKey) && commit()}
        />
        <div className="row" style={{ gap: 6 }}>
          <button className="btn sm primary grow" disabled={busy} onClick={commit}><Check size={14} /> Commit{!git.staged.length && git.unstaged.length ? " all" : ""}</button>
          <button className="btn sm" title="Ask Fish to write the message" onClick={() => onAskAgent("Use the commit-message skill: look at the current git changes in this workspace and propose a commit message. Do not commit.")}><Sparkles size={14} /></button>
        </div>
      </div>
      <div className="tree">
        {git.staged.length > 0 && (
          <>
            <div className="git-group">
              Staged changes <span className="count-pill">{git.staged.length}</span>
              <button className="icon-btn sm" title="Unstage all" onClick={() => call("/git/unstage", { paths: [] })}><Minus size={13} /></button>
            </div>
            {git.staged.map((f) => <Row key={"s" + f.path} f={f} staged />)}
          </>
        )}
        <div className="git-group">
          Changes <span className="count-pill">{git.unstaged.length}</span>
          {git.unstaged.length > 0 && <button className="icon-btn sm" title="Stage all" onClick={() => call("/git/stage", { paths: [] })}><Plus size={13} /></button>}
        </div>
        {git.unstaged.map((f) => <Row key={"u" + f.path} f={f} />)}
        {!git.unstaged.length && !git.staged.length && <div className="small muted" style={{ padding: "6px 14px" }}>Working tree clean.</div>}
      </div>
    </div>
  );
}
