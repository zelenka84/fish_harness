import { useMemo } from "react";

/** Line diff via LCS (falls back to whole replace for very large inputs). */
export function lineDiff(before = "", after = "") {
  const a = before === null ? [] : before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > 4_000_000) {
    return [...a.map((t, i) => ({ t, k: "del", o: i + 1 })), ...b.map((t, i) => ({ t, k: "add", n: i + 1 }))];
  }
  // Trim common prefix/suffix to keep the table small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA--; endB--; }
  const A = a.slice(start, endA), B = b.slice(start, endB);
  const m = A.length, n = B.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  for (let i = 0; i < start; i++) out.push({ t: a[i], k: "eq", o: i + 1, n: i + 1 });
  let i = 0, j = 0;
  while (i < m || j < n) {
    if (i < m && j < n && A[i] === B[j]) { out.push({ t: A[i], k: "eq", o: start + i + 1, n: start + j + 1 }); i++; j++; }
    else if (j < n && (i >= m || dp[i][j + 1] >= dp[i + 1][j])) { out.push({ t: B[j], k: "add", n: start + j + 1 }); j++; }
    else { out.push({ t: A[i], k: "del", o: start + i + 1 }); i++; }
  }
  for (let k = 0; k < a.length - endA; k++) out.push({ t: a[endA + k], k: "eq", o: endA + k + 1, n: endB + k + 1 });
  return out;
}

export function diffStats(lines) {
  let add = 0, del = 0;
  for (const l of lines) l.k === "add" ? add++ : l.k === "del" ? del++ : 0;
  return { add, del };
}

export function DiffStats({ before, after }) {
  const { add, del } = useMemo(() => diffStats(lineDiff(before, after)), [before, after]);
  return (
    <span className="diff-stats">
      <span className="a">+{add}</span> <span className="d">−{del}</span>
    </span>
  );
}

export default function Diff({ before, after, context = 3 }) {
  const rows = useMemo(() => {
    const lines = lineDiff(before, after);
    const keep = new Uint8Array(lines.length);
    lines.forEach((l, i) => {
      if (l.k !== "eq") for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) keep[k] = 1;
    });
    const out = [];
    let skipped = 0;
    lines.forEach((l, i) => {
      if (keep[i]) {
        if (skipped) out.push({ gap: skipped });
        skipped = 0;
        out.push(l);
      } else skipped++;
    });
    if (skipped && out.length) out.push({ gap: skipped });
    return out;
  }, [before, after, context]);

  return (
    <div className="diff">
      {rows.map((r, i) =>
        r.gap ? (
          <div key={i} className="diff-line gap">⋯ {r.gap} unchanged lines</div>
        ) : (
          <div key={i} className={`diff-line ${r.k}`}>
            <span className="ln">{r.k === "add" ? r.n : r.o}</span>
            <span className="sg">{r.k === "add" ? "+" : r.k === "del" ? "−" : " "}</span>
            <span>{r.t || " "}</span>
          </div>
        ),
      )}
    </div>
  );
}
