import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChevronRight, Folder, FolderOpen, FilePlus2, FolderPlus, RefreshCw, ChevronsDownUp, FolderInput, Pencil, Trash2, Copy, MessageSquarePlus, File } from "lucide-react";
import { api, basename } from "../api.js";
import { useApp } from "../App.jsx";
import { FileIcon } from "./icons.jsx";
import ContextMenu from "./ContextMenu.jsx";

const q = (ws) => `workspace=${encodeURIComponent(ws)}`;
const parentOf = (p) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const join = (dir, name) => (dir ? `${dir}/${name}` : name);

/** File tree with create / rename / delete and a right-click menu. */
const Explorer = forwardRef(function Explorer({ ws, active, git, onOpen, onPick, onRenamed, onDeleted, onAddToChat }, ref) {
  const { toast } = useApp();
  const [tree, setTree] = useState({});
  const [open, setOpen] = useState(() => new Set([""]));
  const [editing, setEditing] = useState(null); // { mode: "file"|"folder"|"rename", dir, path?, value }
  const [menu, setMenu] = useState(null);
  const openRef = useRef(open);
  openRef.current = open;

  const loadDir = useCallback(
    async (dir) => {
      try {
        const entries = await api(`/fs/list?${q(ws)}&path=${encodeURIComponent(dir)}`);
        setTree((t) => ({ ...t, [dir]: entries }));
      } catch {
        setTree((t) => {
          const { [dir]: _, ...rest } = t;
          return rest;
        });
      }
    },
    [ws],
  );

  useEffect(() => {
    setTree({});
    setOpen(new Set([""]));
    loadDir("");
  }, [ws, loadDir]);

  const refreshAll = () => [...openRef.current].forEach(loadDir);
  useImperativeHandle(ref, () => ({ reload: (dir) => (dir == null ? refreshAll() : loadDir(dir)), reveal }), [loadDir]);

  const reveal = (path) => {
    const parts = path.split("/");
    const dirs = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("/"));
    setOpen((s) => new Set([...s, "", ...dirs]));
    dirs.forEach(loadDir);
  };

  const toggle = (dir) => {
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(dir)) n.delete(dir);
      else {
        n.add(dir);
        loadDir(dir);
      }
      return n;
    });
  };

  const startCreate = (mode, dir = "") => {
    if (dir) setOpen((s) => new Set([...s, dir]));
    if (dir && !tree[dir]) loadDir(dir);
    setEditing({ mode, dir, value: "" });
  };

  const commit = async () => {
    const e = editing;
    const name = e?.value.trim();
    setEditing(null);
    if (!name) return;
    try {
      if (e.mode === "rename") {
        const to = join(parentOf(e.path), name);
        if (to === e.path) return;
        await api("/fs/rename", { method: "POST", body: { workspace: ws, from: e.path, to } });
        onRenamed?.(e.path, to);
        loadDir(parentOf(e.path));
      } else {
        const path = join(e.dir, name);
        await api("/fs/create", { method: "POST", body: { workspace: ws, path, dir: e.mode === "folder" } });
        loadDir(e.dir);
        if (name.includes("/")) refreshAll();
        if (e.mode === "file") onOpen(path);
      }
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const remove = async (entry) => {
    if (!confirm(`Delete ${entry.dir ? "folder" : "file"} "${entry.name}"${entry.dir ? " and everything in it" : ""}? This cannot be undone.`)) return;
    try {
      await api("/fs/delete", { method: "POST", body: { workspace: ws, path: entry.path } });
      onDeleted?.(entry.path);
      loadDir(parentOf(entry.path));
      toast(`Deleted ${entry.name}`);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  const showMenu = (e, entry) => {
    e.preventDefault();
    e.stopPropagation();
    const dir = entry ? (entry.dir ? entry.path : parentOf(entry.path)) : "";
    const items = [
      { icon: FilePlus2, label: "New file", run: () => startCreate("file", dir) },
      { icon: FolderPlus, label: "New folder", run: () => startCreate("folder", dir) },
    ];
    if (entry) {
      items.push(
        { sep: true },
        { icon: Pencil, label: "Rename", hint: "F2", run: () => setEditing({ mode: "rename", path: entry.path, value: entry.name }) },
        { icon: Copy, label: "Copy relative path", run: () => (navigator.clipboard?.writeText(entry.path), toast("Path copied")) },
        { icon: MessageSquarePlus, label: "Add to agent chat", run: () => onAddToChat?.(entry.path) },
        { sep: true },
        { icon: Trash2, label: "Delete", danger: true, run: () => remove(entry) },
      );
    }
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const editRow = (depth) => (
    <div className="tree-row" style={{ paddingLeft: 8 + depth * 14 }}>
      <span className="chev" />
      {editing.mode === "folder" ? <Folder size={15} /> : <File size={15} />}
      <input
        className="tree-input"
        autoFocus
        value={editing.value}
        placeholder={editing.mode === "folder" ? "folder name" : "file name (a/b.ts creates folders)"}
        onChange={(e) => setEditing((x) => ({ ...x, value: e.target.value }))}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(null);
        }}
        onBlur={commit}
        onFocus={(e) => editing.mode === "rename" && e.target.setSelectionRange(0, editing.value.lastIndexOf(".") > 0 ? editing.value.lastIndexOf(".") : editing.value.length)}
      />
    </div>
  );

  const renderDir = (dir, depth) => (
    <>
      {editing && editing.mode !== "rename" && editing.dir === dir && editRow(depth)}
      {(tree[dir] || []).map((e) => {
        const status = git.get(e.path) || (e.dir && [...git.keys()].some((k) => k.startsWith(e.path + "/")) ? "•" : "");
        if (editing?.mode === "rename" && editing.path === e.path) return <div key={e.path}>{editRow(depth)}</div>;
        return (
          <div key={e.path}>
            <button
              className={`tree-row ${active === e.path ? "active" : ""} ${status ? `git-${status === "•" ? "dir" : status}` : ""}`}
              style={{ paddingLeft: 8 + depth * 14 }}
              onClick={() => (e.dir ? toggle(e.path) : onOpen(e.path))}
              onContextMenu={(ev) => showMenu(ev, e)}
              onKeyDown={(ev) => ev.key === "F2" && setEditing({ mode: "rename", path: e.path, value: e.name })}
              title={e.path}
            >
              {e.dir ? <ChevronRight size={14} className={`chev ${open.has(e.path) ? "open" : ""}`} /> : <span className="chev" />}
              {e.dir ? open.has(e.path) ? <FolderOpen size={15} className="ic-folder" /> : <Folder size={15} className="ic-folder" /> : <FileIcon name={e.name} />}
              <span className="ellipsis name">{e.name}</span>
              {status && <span className="mod">{status === "?" ? "U" : status}</span>}
            </button>
            {e.dir && open.has(e.path) && renderDir(e.path, depth + 1)}
          </div>
        );
      })}
    </>
  );

  return (
    <div className="side-panel">
      <div className="panel-head">
        <span className="grow ellipsis" title={ws}>{basename(ws)}</span>
        <button className="icon-btn sm" title="New file" onClick={() => startCreate("file")}><FilePlus2 size={14} /></button>
        <button className="icon-btn sm" title="New folder" onClick={() => startCreate("folder")}><FolderPlus size={14} /></button>
        <button className="icon-btn sm" title="Refresh" onClick={refreshAll}><RefreshCw size={13} /></button>
        <button className="icon-btn sm" title="Collapse all" onClick={() => setOpen(new Set([""]))}><ChevronsDownUp size={14} /></button>
        <button className="icon-btn sm" title="Open folder…" onClick={onPick}><FolderInput size={14} /></button>
      </div>
      <div className="tree" onContextMenu={(e) => showMenu(e, null)}>
        {renderDir("", 0)}
        {tree[""] && !tree[""].length && !editing && <div className="muted small" style={{ padding: 14 }}>Empty folder. Right-click to create a file.</div>}
      </div>
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  );
});

export default Explorer;
