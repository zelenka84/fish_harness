import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { FileIcon } from "./icons.jsx";

/** Subsequence fuzzy score; higher is better, -1 means no match. */
function score(path, needle) {
  if (!needle) return 0;
  const hay = path.toLowerCase();
  const base = hay.slice(hay.lastIndexOf("/") + 1);
  if (base.startsWith(needle)) return 1000 - base.length;
  if (base.includes(needle)) return 800 - base.length;
  let s = 0;
  let j = 0;
  let streak = 0;
  for (let i = 0; i < hay.length && j < needle.length; i++) {
    if (hay[i] === needle[j]) {
      j++;
      streak++;
      s += 1 + streak * 2 + (i > hay.lastIndexOf("/") ? 3 : 0);
    } else streak = 0;
  }
  return j === needle.length ? s - hay.length * 0.05 : -1;
}

export default function QuickOpen({ ws, recent, onOpen, onClose }) {
  const [files, setFiles] = useState(null);
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    api(`/fs/index?workspace=${encodeURIComponent(ws)}`).then((r) => setFiles(r.files)).catch(() => setFiles([]));
  }, [ws]);

  const [needle, lineStr] = q.trim().toLowerCase().split(":");
  const results = useMemo(() => {
    if (!files) return [];
    if (!needle) {
      const rec = recent.filter((r) => files.includes(r));
      return [...rec, ...files.filter((f) => !rec.includes(f))].slice(0, 50);
    }
    return files
      .map((f) => [f, score(f, needle.replace(/\\/g, "/"))])
      .filter(([, s]) => s >= 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50)
      .map(([f]) => f);
  }, [files, needle, recent]);

  const pick = (f) => {
    onOpen(f, Number(lineStr) || undefined);
    onClose();
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()} style={{ placeItems: "start center" }}>
      <div className="palette" style={{ marginTop: "8vh" }}>
        <input
          autoFocus
          placeholder="Go to file…   (name:line jumps to a line)"
          value={q}
          onChange={(e) => (setQ(e.target.value), setIdx(0))}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") (e.preventDefault(), setIdx((i) => Math.min(results.length - 1, i + 1)));
            if (e.key === "ArrowUp") (e.preventDefault(), setIdx((i) => Math.max(0, i - 1)));
            if (e.key === "Enter" && results[idx]) pick(results[idx]);
          }}
        />
        <div className="results">
          {!files && <div className="muted small" style={{ padding: 14 }}>Indexing…</div>}
          {files && !results.length && <div className="muted small" style={{ padding: 14 }}>No matching files.</div>}
          {!needle && results.length > 0 && recent.length > 0 && <div className="menu-label">Recently opened</div>}
          {results.map((f, i) => (
            <button key={f} className={`menu-item ${i === idx ? "hl" : ""}`} onMouseEnter={() => setIdx(i)} onClick={() => pick(f)}>
              <FileIcon name={f} />
              <span className="ellipsis">{f.split("/").pop()}</span>
              <span className="sub ellipsis" style={{ marginLeft: 6 }}>{f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : ""}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
