import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot, Archive, ScrollText, RotateCcw, FileCode2, FileText, FilePlus2, FilePen, TerminalSquare, Search, FolderTree, Globe, ListTodo, Sparkles, Plug, ChevronRight, Check, X, Brain,
  AlertTriangle, Info, ShieldCheck, ShieldAlert,
} from "lucide-react";
import Markdown from "./Markdown.jsx";
import Diff, { DiffStats } from "./Diff.jsx";
import { FishLogo } from "./ui.jsx";
import { approve } from "../agentStore.js";
import { fmt } from "../api.js";

const TOOL_META = {
  Read: { icon: FileText, kind: "read" },
  Write: { icon: FilePlus2, kind: "write" },
  Edit: { icon: FilePen, kind: "write" },
  Shell: { icon: TerminalSquare, kind: "exec" },
  Glob: { icon: Search, kind: "read" },
  Grep: { icon: Search, kind: "read" },
  ListDir: { icon: FolderTree, kind: "read" },
  WebFetch: { icon: Globe, kind: "read" },
  web_search: { icon: Globe, kind: "read" },
  TodoWrite: { icon: ListTodo, kind: "read" },
  Skill: { icon: Sparkles, kind: "read" },
};
const metaFor = (name) => TOOL_META[name] || (name.startsWith("mcp__") ? { icon: Plug, kind: "mcp" } : { icon: Plug, kind: "read" });

export function toolArg(name, input = {}) {
  if (!input || typeof input !== "object") return "";
  const v = input.file_path || input.command || input.pattern || input.url || input.query || input.path || input.name;
  if (v) return String(v);
  if (name === "TodoWrite") return `${input.todos?.length || 0} tasks`;
  const s = JSON.stringify(input);
  return s === "{}" ? "" : s;
}

function prettyName(name) {
  if (name.startsWith("mcp__")) {
    const [, server, ...tool] = name.split("__");
    return `${server} · ${tool.join("__")}`;
  }
  return name === "web_search" ? "Web search" : name;
}

/** Groups history into user turns and assistant turns. */
function buildTurns(messages, offset = 0) {
  const results = new Map();
  for (const m of messages) {
    if (m.role === "user" && Array.isArray(m.content)) {
      for (const b of m.content) if (b.type === "tool_result") results.set(b.tool_use_id, b);
    }
  }
  const turns = [];
  let current = null;
  messages.forEach((m, i) => {
    if (m.role === "user") {
      const text = typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const files = typeof m.content === "string" ? [] : m.content.filter((b) => b.type === "image" || b.type === "document");
      if (text || files.length) {
        turns.push({ type: "user", text, files, index: offset + i });
        current = null;
      }
    } else if (m.role === "assistant") {
      if (!current) {
        current = { type: "assistant", blocks: [] };
        turns.push(current);
      }
      for (const b of Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]) current.blocks.push(b);
    }
  });
  return { turns, results };
}

export default function Transcript({ entry, compact, onRewind }) {
  const scroller = useRef(null);
  const stick = useRef(true);
  const { session, live, running, tools, approvals, notices, subs } = entry;
  const skip = session.summaryLength || 0;
  const { turns, results } = useMemo(() => buildTurns(session.messages.slice(skip), skip), [session.messages, skip]);
  const archived = useMemo(() => (session.archive?.length ? buildTurns(session.archive) : null), [session.archive]);
  const [showArchive, setShowArchive] = useState(false);
  const shared = { results, tools, approvals, sessionId: session.id, changes: session.changes, subs, saved: session.subagents };

  const lastIsAssistant = turns.at(-1)?.type === "assistant";
  if (running && !lastIsAssistant) turns.push({ type: "assistant", blocks: [], pendingOnly: true });

  useEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  const renderTurn = (t, i, list, { archive = false, sh = shared } = {}) =>
    t.type === "user" ? (
      <div key={i} className="msg-user">
        {t.files?.length > 0 && <UserFiles files={t.files} />}
        {t.text && <div className="bubble">{t.text}</div>}
        {!archive && !running && onRewind && (
          <button className="rewind-btn" title="Rewind to before this message" onClick={() => onRewind(t.index, t.text)}>
            <RotateCcw size={12} /> Rewind
          </button>
        )}
      </div>
    ) : (
      <div key={i} className="msg-assistant">
        <div className="gutter">
          <div className={`fish-avatar ${!archive && running && i === list.length - 1 ? "busy" : ""}`}>
            <FishLogo size={18} id={`av${archive ? "a" : ""}${i}`} />
          </div>
        </div>
        <div className="content">
          {t.blocks.map((b, k) => (
            <Block key={k} block={b} {...sh} />
          ))}
          {!archive && running && i === list.length - 1 && <LiveBlocks live={live} tools={tools} approvals={approvals} sessionId={session.id} subs={subs} />}
        </div>
      </div>
    );

  return (
    <div
      className="transcript"
      ref={scroller}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
    >
      <div className="transcript-inner">
        {archived && (
          <>
            {showArchive && <div className="archived">{archived.turns.map((t, i, l) => renderTurn(t, i, l, { archive: true, sh: { ...shared, results: archived.results } }))}</div>}
            <div className="compact-divider">
              <span />
              <button onClick={() => setShowArchive((v) => !v)}>
                <Archive size={13} /> {session.compactions > 1 ? `Compacted ${session.compactions}×` : "Earlier turns summarized"} — {showArchive ? "hide" : "show"} history
              </button>
              <span />
            </div>
            {session.summary && (
              <details className="summary-card">
                <summary><ScrollText size={13} /> Summary the agent continues from</summary>
                <Markdown text={session.summary} />
              </details>
            )}
          </>
        )}
        {turns.map((t, i, l) => renderTurn(t, i, l))}
        {notices.map((n, i) => (
          <div key={`n${i}`} className={`notice ${n.kind}`}>
            {n.kind === "error" ? <AlertTriangle size={16} /> : <Info size={16} />}
            <span>{n.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function LiveBlocks({ live, tools, approvals, sessionId, subs }) {
  const blocks = live.filter(Boolean);
  if (!blocks.length) {
    return (
      <div className="row small" style={{ color: "var(--text-3)", height: 28 }}>
        <span className="shimmer" style={{ fontWeight: 560 }}>Swimming through your code…</span>
      </div>
    );
  }
  return blocks.map((b, i) => {
    const last = i === blocks.length - 1;
    if (b.type === "thinking") return <Thinking key={i} text={b.thinking} active={last} />;
    if (b.type === "text") return b.text ? <Markdown key={i} text={b.text} streaming={last} /> : null;
    if (b.type === "tool_use" || b.type === "server_tool_use") {
      let input = {};
      try {
        input = b.partial ? JSON.parse(b.partial) : {};
      } catch {
        const m = /"(file_path|command|pattern|url|path|query)"\s*:\s*"([^"]*)/.exec(b.partial || "");
        if (m) input = { [m[1]]: m[2] };
      }
      if (b.name === "Task") return <TaskCard key={i} use={{ ...b, input }} live={subs?.[b.id]} composing />;
      return <ToolCard key={i} use={{ ...b, input }} tools={tools} approvals={approvals} sessionId={sessionId} composing />;
    }
    return null;
  });
}

function Block({ block, results, tools, approvals, sessionId, changes, subs, saved }) {
  if (block.type === "compaction") {
    return (
      <div className="compact-divider inline">
        <span /><em><Archive size={12} /> Context compacted by the API — older turns were summarized</em><span />
      </div>
    );
  }
  if (block.type === "tool_use" && block.name === "Task") {
    return <TaskCard use={block} result={results.get(block.id)} live={subs?.[block.id]} saved={saved?.[block.id]} />;
  }
  if (block.type === "text") return block.text ? <Markdown text={block.text} /> : null;
  if (block.type === "thinking") return block.thinking ? <Thinking text={block.thinking} /> : null;
  if (block.type === "redacted_thinking") return null;
  if (block.type === "tool_use" || block.type === "server_tool_use") {
    return <ToolCard use={block} result={results.get(block.id)} tools={tools} approvals={approvals} sessionId={sessionId} changes={changes} />;
  }
  if (block.type === "web_search_tool_result") {
    const items = Array.isArray(block.content) ? block.content : [];
    return (
      <div className="tool">
        <div className="tool-head">
          <span className="tool-icon read"><Globe size={14} /></span>
          <span className="tool-name">Search results</span>
          <span className="tool-arg">{items.length} sources</span>
        </div>
        <div className="tool-body" style={{ padding: "8px 14px" }}>
          {items.slice(0, 8).map((r, i) => (
            <div key={i} className="small ellipsis"><a href={r.url} target="_blank" rel="noreferrer">{r.title || r.url}</a></div>
          ))}
        </div>
      </div>
    );
  }
  return null;
}

function Thinking({ text, active }) {
  const [open, setOpen] = useState(false);
  const firstLine = (text || "").split("\n").find((l) => l.trim()) || "";
  return (
    <div className="thinking">
      <button className="thinking-head" onClick={() => setOpen((o) => !o)}>
        <Brain size={14} />
        {active ? <span className="shimmer">Thinking…</span> : <span>Thought process</span>}
        {!open && firstLine && <span className="ellipsis" style={{ flex: 1, opacity: 0.7, fontStyle: "italic" }}>{firstLine.replace(/[*#]/g, "")}</span>}
        <ChevronRight size={14} style={{ marginLeft: "auto", transform: open ? "rotate(90deg)" : "", transition: "transform .15s" }} />
      </button>
      {(open || active) && text && <div className="thinking-body">{text}</div>}
    </div>
  );
}

function ToolCard({ use, result, tools, approvals, sessionId, composing, changes }) {
  const live = tools?.[use.id];
  const pending = approvals?.[use.id];
  const { icon: Icon, kind } = metaFor(use.name);
  const isError = result?.is_error || live?.status === "error";
  const running = !result && (live?.status === "running" || composing);
  const [open, setOpen] = useState(false);
  const expanded = open || Boolean(pending) || (use.name === "Shell" && live?.status === "running");
  const arg = toolArg(use.name, use.input);
  const resultText = typeof result?.content === "string" ? result.content : Array.isArray(result?.content) ? result.content.map((c) => c.text || "").join("\n") : "";

  const change = useMemo(() => {
    if (use.name !== "Write" || !changes) return null;
    return [...changes].reverse().find((c) => c.path.replace(/\\/g, "/").endsWith(String(use.input?.file_path || "").replace(/\\/g, "/").replace(/^\.\//, "")));
  }, [changes, use]);

  let status;
  if (pending) status = <span className="badge warn">Needs approval</span>;
  else if (composing && !live) status = <><span className="spin" /> composing</>;
  else if (running) status = <><span className="spin" /> running</>;
  else if (isError) status = <span style={{ color: "var(--bad)", display: "flex", gap: 4, alignItems: "center" }}><X size={13} /> failed</span>;
  else if (result) {
    status = (
      <>
        {use.name === "Edit" && <DiffStats before={use.input?.old_string || ""} after={use.input?.new_string || ""} />}
        {live?.ms != null && <span>{fmt.ms(live.ms)}</span>}
        <Check size={13} style={{ color: "var(--good)" }} />
      </>
    );
  }

  if (use.name === "TodoWrite" && Array.isArray(use.input?.todos)) {
    return <TodoList todos={use.input.todos} />;
  }

  return (
    <div className={`tool ${pending ? "pending" : ""}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className={`tool-icon ${kind}`}><Icon size={14} /></span>
        <span className="tool-name">{prettyName(use.name)}</span>
        <span className="tool-arg" title={arg}>{arg}</span>
        <span className="tool-status">{status}</span>
        <ChevronRight size={14} style={{ color: "var(--text-4)", transform: expanded ? "rotate(90deg)" : "", transition: "transform .15s" }} />
      </button>
      {expanded && (
        <div className="tool-body">
          {use.name === "Edit" && use.input?.old_string != null ? (
            <Diff before={use.input.old_string} after={use.input.new_string || ""} context={6} />
          ) : use.name === "Write" && use.input?.content != null ? (
            change ? <Diff before={change.before} after={change.after} /> : <pre>{use.input.content}</pre>
          ) : use.name === "Shell" ? (
            <pre>
              <span style={{ color: "var(--accent)" }}>$ {use.input?.command}</span>
              {"\n"}
              {resultText || live?.output || ""}
            </pre>
          ) : resultText ? (
            <pre className={isError ? "err" : ""}>{resultText}</pre>
          ) : (
            <pre>{JSON.stringify(use.input, null, 2)}</pre>
          )}
          {isError && use.name !== "Shell" && (use.name === "Edit" || use.name === "Write") && <pre className="err">{resultText}</pre>}
        </div>
      )}
      {pending && (
        <div className="approval">
          <ShieldAlert size={16} style={{ color: "var(--warn)" }} />
          <span className="q">Allow {prettyName(use.name)}{use.name === "Shell" ? " to run this command" : use.name.startsWith("mcp__") ? "" : " to modify this file"}?</span>
          <button className="btn xs danger" onClick={() => approve(sessionId, use.id, "deny")}>Deny</button>
          <button className="btn xs" onClick={() => approve(sessionId, use.id, "allow_always")}><ShieldCheck size={12} /> Always</button>
          <button className="btn xs primary" onClick={() => approve(sessionId, use.id, "allow")}>Allow</button>
        </div>
      )}
    </div>
  );
}

export function TodoList({ todos, plain }) {
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <div className={plain ? "" : "tool"} style={plain ? undefined : { padding: "6px 6px 4px" }}>
      {!plain && (
        <div className="row small" style={{ padding: "4px 8px 6px", color: "var(--text-3)" }}>
          <ListTodo size={14} /> Tasks <span className="badge accent" style={{ marginLeft: "auto" }}>{done}/{todos.length}</span>
        </div>
      )}
      {todos.map((t, i) => (
        <div key={i} className={`todo ${t.status}`}>
          <span className="ic">
            {t.status === "completed" ? (
              <Check size={15} style={{ color: "var(--good)" }} />
            ) : t.status === "in_progress" ? (
              <span className="spin" style={{ display: "inline-block" }} />
            ) : (
              <span style={{ display: "inline-block", width: 13, height: 13, borderRadius: 99, border: "1.5px solid var(--text-4)" }} />
            )}
          </span>
          <span className="txt">{t.content}</span>
        </div>
      ))}
    </div>
  );
}

function UserFiles({ files }) {
  const [open, setOpen] = useState(null);
  return (
    <div className="user-files">
      {files.map((f, i) => {
        if (f.type === "image") {
          const src = `data:${f.source.media_type};base64,${f.source.data}`;
          return <img key={i} className="user-img" src={src} alt="" onClick={() => setOpen(src)} />;
        }
        const pdf = f.source?.media_type === "application/pdf";
        return (
          <div key={i} className="attach-chip" title={f.title}>
            {pdf ? <FileText size={15} /> : <FileCode2 size={15} />}
            <span className="ellipsis">{f.title || "document"}</span>
            <span className="sub">{pdf ? "PDF" : `${(f.source?.data || "").split("\n").length} lines`}</span>
          </div>
        );
      })}
      {open && (
        <div className="overlay" onClick={() => setOpen(null)}>
          <img src={open} alt="" className="lightbox" />
        </div>
      )}
    </div>
  );
}

/** A subagent run: its brief, live/persisted tool calls, and the final report. */
function TaskCard({ use, result, live, saved, composing }) {
  const [open, setOpen] = useState(false);
  const calls = live?.calls || saved?.calls || [];
  const running = !result && (live?.status === "running" || composing);
  const isError = result?.is_error;
  const report = typeof result?.content === "string" ? result.content : "";
  const last = calls.at(-1);
  return (
    <div className={`tool task-card ${running ? "running" : ""}`}>
      <button className="tool-head" onClick={() => setOpen((o) => !o)}>
        <span className="tool-icon agent"><Bot size={14} /></span>
        <span className="tool-name">Subagent</span>
        <span className="tool-arg" title={use.input?.prompt}>{use.input?.description || "…"}</span>
        <span className="tool-status">
          {running ? (
            <><span className="spin" /> {last ? `${last.name}` : "starting"}</>
          ) : isError ? (
            <span style={{ color: "var(--bad)" }}>failed</span>
          ) : result ? (
            <>{calls.length} tool calls <Check size={13} style={{ color: "var(--good)" }} /></>
          ) : null}
        </span>
        <ChevronRight size={14} style={{ color: "var(--text-4)", transform: open ? "rotate(90deg)" : "", transition: "transform .15s" }} />
      </button>
      {(running || open) && calls.length > 0 && (
        <div className="task-calls">
          {calls.slice(open ? 0 : -4).map((c, i) => {
            const Icon = metaFor(c.name).icon;
            return (
              <div key={i} className={`task-call ${c.isError ? "err" : ""}`}>
                <Icon size={12} /> <b>{c.name}</b> <span className="ellipsis">{toolArg(c.name, c.input)}</span>
                {c.done === false && <span className="spin" style={{ marginLeft: "auto", width: 10, height: 10 }} />}
              </div>
            );
          })}
        </div>
      )}
      {open && report && (
        <div className="tool-body" style={{ padding: "10px 14px" }}>
          <Markdown text={report} />
        </div>
      )}
    </div>
  );
}
