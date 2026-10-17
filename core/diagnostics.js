// Compiler / linter diagnostics for the IDE and for the agent's own edits.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const TS_WORKER = path.join(here, "tsdiag-worker.cjs");

/** Run a command with stdin, resolve { code, stdout, stderr } (never rejects). */
function run(cmd, args, { input, cwd, env, timeout = 20000 } = {}) {
  // Windows can only start .cmd shims (eslint, tsc) through a shell.
  const shell = process.platform === "win32" && /\.cmd$/i.test(cmd);
  if (shell) {
    const q = (a) => `"${String(a).replace(/"/g, '\\"')}"`;
    [cmd, args] = [[q(cmd), ...args.map(q)].join(" "), []];
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, shell });
    } catch (e) {
      return resolve({ code: -1, stdout: "", stderr: e.message, missing: true });
    }
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill(), timeout);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: e.message, missing: e.code === "ENOENT" });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

// Node inside Electron runs scripts with ELECTRON_RUN_AS_NODE.
const nodeEnv = process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};

function withTemp(ext, content, fn) {
  const file = path.join(os.tmpdir(), `fish-diag-${crypto.randomBytes(6).toString("hex")}${ext}`);
  fs.writeFileSync(file, content);
  return fn(file).finally(() => fs.rmSync(file, { force: true }));
}

function lineColFromOffset(text, offset) {
  const before = text.slice(0, offset).split("\n");
  return { line: before.length, col: before.at(-1).length + 1 };
}

/** Offset of the first JSON syntax error (V8 no longer reports positions). */
function jsonErrorOffset(s) {
  let i = 0;
  const ws = () => {
    while (i < s.length && " \t\r\n".includes(s[i])) i++;
  };
  const fail = () => {
    throw i;
  };
  const value = () => {
    ws();
    const c = s[i];
    if (c === "{") {
      i++;
      ws();
      if (s[i] === "}") return void i++;
      for (;;) {
        ws();
        if (s[i] !== '"') fail();
        string();
        ws();
        if (s[i++] !== ":") (i--, fail());
        value();
        ws();
        if (s[i] === ",") i++;
        else if (s[i] === "}") return void i++;
        else fail();
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (s[i] === "]") return void i++;
      for (;;) {
        value();
        ws();
        if (s[i] === ",") i++;
        else if (s[i] === "]") return void i++;
        else fail();
      }
    }
    if (c === '"') return string();
    const m = /^(-?\d+(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(s.slice(i, i + 64));
    if (!m) fail();
    i += m[0].length;
  };
  const string = () => {
    i++;
    while (i < s.length && s[i] !== '"') i += s[i] === "\\" ? 2 : 1;
    if (i >= s.length) fail();
    i++;
  };
  try {
    value();
    ws();
    return i < s.length ? i : -1;
  } catch (at) {
    return Math.min(at, s.length);
  }
}

function jsonDiag(content) {
  try {
    JSON.parse(content);
    return [];
  } catch (e) {
    const offset = jsonErrorOffset(content);
    const at = offset >= 0 ? lineColFromOffset(content, offset) : { line: 1, col: 1 };
    const message = e.message.replace(/^JSON\.parse: /, "").replace(/, ".*" is not valid JSON$/s, "");
    return [{ ...at, severity: "error", message, source: "json" }];
  }
}

async function nodeCheck(ext, content) {
  return withTemp(ext, content, async (file) => {
    const r = await run(process.execPath, ["--check", file], { env: nodeEnv });
    if (r.code === 0) return [];
    const lines = r.stderr.split(/\r?\n/);
    const head = lines.findIndex((l) => l.includes(path.basename(file)));
    const line = Number(/:(\d+)\s*$/.exec(lines[head] || "")?.[1]) || 1;
    const caret = lines.slice(head + 1).find((l) => /^\s*\^+\s*$/.test(l));
    const col = caret ? caret.indexOf("^") + 1 : 1;
    const msg = lines.find((l) => /Error:/.test(l)) || "Syntax error";
    return [{ line, col, severity: "error", message: msg.trim(), source: "node" }];
  });
}

async function eslint(ws, abs, content) {
  const bin = path.join(ws, "node_modules", ".bin", process.platform === "win32" ? "eslint.cmd" : "eslint");
  if (!fs.existsSync(bin)) return null;
  const r = await run(bin, ["--format", "json", "--stdin", "--stdin-filename", abs], { input: content, cwd: ws, timeout: 30000 });
  try {
    const [res] = JSON.parse(r.stdout);
    return (res?.messages || []).map((m) => ({
      line: m.line || 1, col: m.column || 1, endLine: m.endLine, endCol: m.endColumn,
      severity: m.severity === 2 ? "error" : "warning", message: m.message, source: `eslint${m.ruleId ? `(${m.ruleId})` : ""}`,
    }));
  } catch {
    return null;
  }
}

async function typescript(ws, abs, content) {
  const pkg = path.join(ws, "node_modules", "typescript", "package.json");
  if (!fs.existsSync(pkg)) return null;
  const major = Number(JSON.parse(fs.readFileSync(pkg, "utf8")).version.split(".")[0]);
  if (major < 7) {
    // TS ≤ 6: in-process compiler API in a worker, checks the unsaved buffer.
    const r = await run(process.execPath, [TS_WORKER], { input: JSON.stringify({ ws, file: abs, content }), env: nodeEnv, timeout: 60000 });
    try {
      return JSON.parse(r.stdout);
    } catch {
      return null;
    }
  }
  // TS 7 (native) has no JS compiler API: run the project's tsc and keep this file's errors.
  // It reads files from disk, so results reflect the last save.
  const bin = path.join(ws, "node_modules", ".bin", process.platform === "win32" ? "tsc.cmd" : "tsc");
  const hasConfig = fs.existsSync(path.join(ws, "tsconfig.json"));
  const args = hasConfig ? ["--noEmit", "-p", ws, "--pretty", "false"] : ["--noEmit", "--pretty", "false", "--skipLibCheck", "--jsx", "react-jsx", abs];
  const r = await run(bin, args, { cwd: ws, timeout: 60000 });
  if (r.missing) return null;
  const target = path.resolve(abs).toLowerCase();
  const out = [];
  for (const line of (r.stdout + r.stderr).split(/\r?\n/)) {
    const m = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/.exec(line.trim());
    if (m && path.resolve(ws, m[1]).toLowerCase() === target) {
      out.push({ line: +m[2], col: +m[3], severity: m[4], message: m[6], source: `ts(${m[5].slice(2)})` });
    }
  }
  return out;
}

async function python(ext, content, abs, ws) {
  const out = await withTemp(ext, content, async (file) => {
    for (const py of process.platform === "win32" ? ["python", "py"] : ["python3", "python"]) {
      const r = await run(py, ["-m", "py_compile", file]);
      if (r.missing) continue;
      if (r.code === 0) return [];
      const line = Number(/line (\d+)/.exec(r.stderr)?.[1]) || 1;
      const msg = r.stderr.split(/\r?\n/).filter(Boolean).pop() || "Syntax error";
      return [{ line, col: 1, severity: "error", message: msg.trim(), source: "python" }];
    }
    return null;
  });
  const list = out ?? [];
  const ruff = await run("ruff", ["check", "--output-format", "json", "--stdin-filename", abs, "-"], { input: content, cwd: ws });
  if (!ruff.missing) {
    try {
      for (const d of JSON.parse(ruff.stdout)) {
        list.push({ line: d.location.row, col: d.location.column, endLine: d.end_location?.row, endCol: d.end_location?.column, severity: "warning", message: d.message, source: `ruff(${d.code})` });
      }
    } catch {}
    return list;
  }
  return out;
}

/**
 * @param {{ workspace: string, path: string, content?: string, quick?: boolean }} opts
 *   quick: syntax-only checks that finish in well under a second (used after agent edits).
 * @returns {Promise<{ diagnostics: object[], checkers: string[] }>}
 */
export async function diagnose({ workspace, path: rel, content, quick = false }) {
  const abs = path.resolve(workspace, rel);
  const text = content ?? fs.readFileSync(abs, "utf8");
  const ext = path.extname(abs).toLowerCase();
  const diagnostics = [];
  const checkers = [];
  const add = (name, list) => {
    if (list == null) return;
    checkers.push(name);
    diagnostics.push(...list);
  };

  if (ext === ".json") add("json", /tsconfig|jsconfig|\.vscode/.test(abs) ? [] : jsonDiag(text));
  else if ([".js", ".mjs", ".cjs"].includes(ext)) {
    add("node", await nodeCheck(ext, text));
    if (!quick) add("eslint", await eslint(workspace, abs, text));
  } else if ([".ts", ".tsx", ".jsx", ".mts", ".cts"].includes(ext)) {
    if (!quick) {
      add("typescript", await typescript(workspace, abs, text));
      add("eslint", await eslint(workspace, abs, text));
    }
  } else if (ext === ".py") add("python", await python(ext, text, abs, workspace));

  diagnostics.sort((a, b) => a.line - b.line || a.col - b.col);
  return { diagnostics, checkers };
}

/** One-line summary appended to the agent's Write/Edit result so it notices broken files. */
export async function quickReport(workspace, file) {
  try {
    const { diagnostics } = await diagnose({ workspace, path: file, quick: true });
    const errors = diagnostics.filter((d) => d.severity === "error");
    if (!errors.length) return "";
    return `\n⚠ Diagnostics after this change:\n${errors.slice(0, 5).map((d) => `  line ${d.line}:${d.col} ${d.message}`).join("\n")}`;
  } catch {
    return "";
  }
}
