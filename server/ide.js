// IDE back end: file operations, search, quick-open index, git and terminals.
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import fg from "fast-glob";
import { loadConfig } from "../core/config.js";
import { isInside } from "../core/tools.js";
import { completeCode, completionModel } from "../core/complete.js";
import { diagnose } from "../core/diagnostics.js";

const IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/.next/**", "**/__pycache__/**", "**/.venv/**", "**/out/**", "**/target/**"];
const err = (message, status = 400) => Object.assign(new Error(message), { status });

function resolveIn(ws, rel) {
  const root = path.resolve(ws || loadConfig().workspace);
  const target = path.resolve(root, rel || ".");
  if (!isInside(root, target)) throw err("Path outside workspace", 403);
  return { root, target };
}

function git(cwd, args, input) {
  return new Promise((resolve, reject) => {
    const child = execFile("git", args, { cwd, windowsHide: true, maxBuffer: 20 * 1024 * 1024 }, (e, stdout, stderr) => {
      if (e) reject(err((stderr || e.message).trim()));
      else resolve(stdout);
    });
    if (input != null) child.stdin.end(input);
  });
}

export function ideRoutes(route) {
  /* ---------------------------- inline completion --------------------------- */
  route("POST", "/api/complete", async (req, body) => {
    const config = loadConfig();
    if (config.completionEnabled === false) return { text: "" };
    const controller = new AbortController();
    req.on("close", () => controller.abort());
    try {
      return await completeCode({ path: body.path || "", prefix: body.prefix || "", suffix: body.suffix || "", signal: controller.signal });
    } catch (e) {
      if (controller.signal.aborted) return { text: "" };
      throw err(e.message, 502);
    }
  });
  route("POST", "/api/diagnostics", async (req, body) => {
    const { root, target } = resolveIn(body.workspace, body.path);
    return diagnose({ workspace: root, path: target, content: body.content });
  });
  route("GET", "/api/complete/model", () => ({ model: completionModel() }));

  /* ------------------------------- file ops ------------------------------- */
  route("POST", "/api/fs/create", (req, body) => {
    const { target } = resolveIn(body.workspace, body.path);
    if (fs.existsSync(target)) throw err("Already exists");
    if (body.dir) fs.mkdirSync(target, { recursive: true });
    else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, body.content || "");
    }
    return { ok: true };
  });
  route("POST", "/api/fs/rename", (req, body) => {
    const { target: from } = resolveIn(body.workspace, body.from);
    const { target: to } = resolveIn(body.workspace, body.to);
    if (fs.existsSync(to)) throw err("A file with that name already exists");
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    return { ok: true };
  });
  route("POST", "/api/fs/delete", (req, body) => {
    const { root, target } = resolveIn(body.workspace, body.path);
    if (target === root) throw err("Refusing to delete the workspace root");
    fs.rmSync(target, { recursive: true, force: true });
    return { ok: true };
  });

  // Raw bytes of a workspace file, for image tabs and images inside Markdown previews.
  const RAW_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp",
    ".svg": "image/svg+xml", ".ico": "image/x-icon", ".bmp": "image/bmp", ".avif": "image/avif",
  };
  route("GET", "/api/fs/raw", (req, body, q, p, res) => {
    const { target } = resolveIn(q.get("workspace"), q.get("path"));
    const type = RAW_TYPES[path.extname(target).toLowerCase()];
    if (!type) throw err("Only images can be previewed", 415);
    if (!fs.existsSync(target)) throw err("File not found", 404);
    // SVG can carry scripts: serve it inert.
    res.writeHead(200, { "content-type": type, "cache-control": "no-cache", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" });
    fs.createReadStream(target).pipe(res);
    return undefined;
  });

  /* ------------------------- quick open + search -------------------------- */
  route("GET", "/api/fs/index", async (req, body, q) => {
    const { root } = resolveIn(q.get("workspace"));
    const files = await fg("**/*", { cwd: root, ignore: IGNORE, dot: true, onlyFiles: true, suppressErrors: true });
    return { files: files.slice(0, 30000), truncated: files.length > 30000 };
  });
  route("GET", "/api/fs/search", async (req, body, q) => {
    const { root } = resolveIn(q.get("workspace"));
    const query = q.get("q") || "";
    if (!query) return { results: [] };
    const flags = q.get("case") === "1" ? "g" : "gi";
    let re;
    try {
      re = q.get("regex") === "1" ? new RegExp(query, flags) : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);
    } catch (e) {
      throw err(`Invalid regex: ${e.message}`);
    }
    const files = await fg(q.get("glob") || "**/*", { cwd: root, ignore: IGNORE, onlyFiles: true, suppressErrors: true });
    const results = [];
    let total = 0;
    for (const f of files) {
      if (total >= 2000) break;
      const full = path.join(root, f);
      let text;
      try {
        if (fs.statSync(full).size > 1_500_000) continue;
        text = fs.readFileSync(full, "utf8");
      } catch {
        continue;
      }
      if (text.includes("\u0000")) continue;
      const matches = [];
      text.split(/\r?\n/).forEach((line, i) => {
        re.lastIndex = 0;
        const m = re.exec(line);
        if (m && total < 2000) {
          matches.push({ line: i + 1, col: m.index + 1, text: line.slice(0, 300), len: m[0].length });
          total++;
        }
      });
      if (matches.length) results.push({ path: f, matches });
    }
    return { results, total, capped: total >= 2000 };
  });

  /* ---------------------------------- git --------------------------------- */
  route("GET", "/api/git/status", async (req, body, q) => {
    const { root } = resolveIn(q.get("workspace"));
    let out;
    try {
      out = await git(root, ["status", "--porcelain=v1", "-b", "-uall"]);
    } catch {
      return { repo: false };
    }
    const lines = out.split("\n").filter(Boolean);
    const head = (lines.shift() || "").replace(/^## /, "");
    const [branch, tracking = ""] = head.split("...");
    const ahead = /ahead (\d+)/.exec(tracking)?.[1] || 0;
    const behind = /behind (\d+)/.exec(tracking)?.[1] || 0;
    const staged = [];
    const unstaged = [];
    for (const l of lines) {
      const x = l[0], y = l[1];
      let p = l.slice(3);
      if (p.includes(" -> ")) p = p.split(" -> ")[1];
      p = p.replace(/^"|"$/g, "");
      if (x === "?" && y === "?") unstaged.push({ path: p, status: "U" });
      else {
        if (x !== " ") staged.push({ path: p, status: x });
        if (y !== " ") unstaged.push({ path: p, status: y });
      }
    }
    return { repo: true, branch, ahead: Number(ahead), behind: Number(behind), staged, unstaged };
  });
  route("GET", "/api/git/diff", async (req, body, q) => {
    const { root, target } = resolveIn(q.get("workspace"), q.get("path"));
    const rel = path.relative(root, target).replace(/\\/g, "/");
    let head = "";
    try {
      head = await git(root, ["show", `HEAD:${rel}`]);
    } catch {
      head = null; // new file
    }
    const work = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    return { head, work };
  });
  route("POST", "/api/git/stage", async (req, body) => {
    const { root } = resolveIn(body.workspace);
    await git(root, ["add", "--", ...(body.paths?.length ? body.paths : ["."])]);
    return { ok: true };
  });
  route("POST", "/api/git/unstage", async (req, body) => {
    const { root } = resolveIn(body.workspace);
    await git(root, ["reset", "-q", "HEAD", "--", ...(body.paths?.length ? body.paths : ["."])]);
    return { ok: true };
  });
  route("POST", "/api/git/discard", async (req, body) => {
    const { root } = resolveIn(body.workspace);
    for (const p of body.paths || []) {
      try {
        await git(root, ["checkout", "--", p]);
      } catch {
        // Untracked file: discarding means removing it.
        const { target } = resolveIn(root, p);
        fs.rmSync(target, { force: true });
      }
    }
    return { ok: true };
  });
  route("POST", "/api/git/commit", async (req, body) => {
    const { root } = resolveIn(body.workspace);
    if (!body.message?.trim()) throw err("Commit message is required");
    const out = await git(root, ["commit", "-F", "-"], body.message);
    return { ok: true, output: out.trim() };
  });
  route("POST", "/api/git/init", async (req, body) => {
    const { root } = resolveIn(body.workspace);
    await git(root, ["init"]);
    return { ok: true };
  });
}

/* -------------------------------- terminal -------------------------------- */

export async function attachTerminal(server, originOk) {
  let pty;
  let WebSocketServer;
  try {
    pty = (await import("@lydell/node-pty")).default;
    ({ WebSocketServer } = await import("ws"));
  } catch (e) {
    console.warn("Terminal disabled:", e.message);
    return;
  }
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname !== "/api/term" || !originOk(req.headers.origin)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      let cwd = url.searchParams.get("cwd") || loadConfig().workspace;
      if (!fs.existsSync(cwd)) cwd = loadConfig().workspace;
      const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/bash";
      const args = process.platform === "win32" ? ["-NoLogo"] : ["-l"];
      const term = pty.spawn(shell, args, {
        name: "xterm-256color",
        cols: Number(url.searchParams.get("cols")) || 100,
        rows: Number(url.searchParams.get("rows")) || 24,
        cwd,
        env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" },
      });
      term.onData((d) => ws.readyState === 1 && ws.send(d));
      term.onExit(({ exitCode }) => {
        if (ws.readyState === 1) ws.send(`\r\n\x1b[2m[process exited with code ${exitCode}]\x1b[0m\r\n`);
        ws.close();
      });
      ws.on("message", (raw) => {
        const msg = raw.toString();
        if (msg.startsWith("\u0000resize:")) {
          const [cols, rows] = msg.slice(8).split("x").map(Number);
          if (cols > 0 && rows > 0) term.resize(cols, rows);
        } else term.write(msg);
      });
      ws.on("close", () => {
        try {
          term.kill();
        } catch {}
      });
    });
  });
}
