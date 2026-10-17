import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Harness, TASK_TOOL } from "../core/agent.js";
import { loadConfig, publicConfig, applyPublicPatch, PROMPT_PRESETS, saveConfig } from "../core/config.js";
import { MODELS, EFFORTS, PROVIDER_PRESETS } from "../core/models.js";
import { listProviderModels, describeApiError } from "../core/providers.js";
import { listSkills, readSkill, saveSkill, deleteSkill, seedSkills } from "../core/skills.js";
import { discoverExternalMcp } from "../core/mcp.js";
import { isInside, BUILTIN_TOOLS } from "../core/tools.js";
import * as store from "../core/store.js";
import { FISH_HOME } from "../core/paths.js";
import { applyProxy, describeProxy } from "../core/net.js";
import { DEFAULT_TEMPLATE, VARIABLES } from "../core/prompt.js";
import { ideRoutes, attachTerminal } from "./ide.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const UI_DIST = path.resolve(here, "..", "ui", "dist");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".ico": "image/x-icon" };

export async function startServer({ port = 4317, host = "127.0.0.1" } = {}) {
  applyProxy(loadConfig());
  seedSkills();
  const harness = new Harness();
  harness.init().catch(() => {});
  const runs = new Map(); // runId -> { controller, approvals: Map<id, resolve>, sessionId }
  const tokens = new Map(); // token -> accountId

  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp("^" + pattern.replace(/:([a-z]+)/gi, (_, k) => (keys.push(k), "([^/]+)")) + "$");
    routes.push({ method, re, keys, handler });
  };

  const accountOf = (req) => {
    const id = req.headers["x-fish-account"] || "local";
    const acc = store.listAccounts().find((a) => a.id === id) || store.listAccounts()[0];
    if (acc.protected && tokens.get(req.headers["x-fish-token"]) !== acc.id) {
      const e = new Error("Account locked");
      e.status = 401;
      throw e;
    }
    return acc.id;
  };

  /* ---------------------------------- state ---------------------------------- */
  route("GET", "/api/state", () => ({
    config: publicConfig(),
    models: MODELS,
    efforts: EFFORTS,
    presets: PROMPT_PRESETS,
    providerPresets: PROVIDER_PRESETS,
    network: describeProxy(loadConfig()),
    accounts: store.listAccounts(),
    tools: [...BUILTIN_TOOLS, TASK_TOOL].map((t) => ({ name: t.name, kind: t.kind, description: t.description })),
    home: FISH_HOME,
    platform: process.platform,
    version: "1.0.0",
  }));
  route("PUT", "/api/config", async (req, body) => {
    const next = applyPublicPatch(body);
    if ("proxy" in body) applyProxy(next);
    if (body.mcpServers) await harness.mcp.sync(next.mcpServers);
    return publicConfig();
  });
  // Fetch a provider's model list. A masked key means "use the stored one".
  route("POST", "/api/providers/models", async (req, body) => {
    const stored = loadConfig().providers.find((p) => p.id === body.id);
    const apiKey = body.apiKey && !body.apiKey.includes("…") ? body.apiKey : stored?.apiKey || "";
    try {
      return await listProviderModels({ ...stored, ...body, apiKey });
    } catch (err) {
      throw Object.assign(new Error(describeApiError(err)), { status: 400 });
    }
  });
  /* --------------------------- Dev-Mode prompt editor --------------------------- */
  route("GET", "/api/dev/prompt", (req, body, q) => {
    const config = loadConfig();
    const workspace = q.get("workspace") || config.workspace;
    const vars = harness.promptVars(workspace);
    return {
      defaultTemplate: DEFAULT_TEMPLATE,
      template: config.promptTemplate || { enabled: false, text: "" },
      variables: VARIABLES.map((v) => ({ ...v, value: vars[v.name] ?? "" })),
      presets: PROMPT_PRESETS.map((p) => ({ ...p, override: config.presetOverrides?.[p.id] || "" })),
      rendered: harness.buildSystemPrompt(workspace),
    };
  });
  route("POST", "/api/dev/prompt/preview", (req, body) => {
    const workspace = body.workspace || loadConfig().workspace;
    return { text: harness.buildSystemPrompt(workspace, body.template ?? undefined) };
  });
  route("GET", "/api/system-prompt", (req, body, q) => ({ text: harness.buildSystemPrompt(q.get("workspace") || loadConfig().workspace) }));

  /* -------------------------------- accounts --------------------------------- */
  route("GET", "/api/accounts", () => store.listAccounts());
  route("POST", "/api/accounts", (req, body) => store.createAccount(body));
  route("PATCH", "/api/accounts/:id", (req, body, q, p) => {
    if (accountOf(req) !== p.id) throw Object.assign(new Error("Sign in to this account first"), { status: 403 });
    store.updateAccount(p.id, body);
    return store.listAccounts();
  });
  route("DELETE", "/api/accounts/:id", (req, body, q, p) => {
    if (accountOf(req) !== p.id) throw Object.assign(new Error("Sign in to this account first"), { status: 403 });
    store.deleteAccount(p.id);
    return store.listAccounts();
  });
  route("POST", "/api/accounts/:id/login", (req, body, q, p) => {
    if (!store.verifyAccount(p.id, body.password)) throw Object.assign(new Error("Wrong password"), { status: 401 });
    const token = crypto.randomBytes(24).toString("hex");
    tokens.set(token, p.id);
    return { token };
  });

  /* -------------------------------- sessions --------------------------------- */
  route("GET", "/api/sessions", (req) => store.listSessions(accountOf(req)));
  route("POST", "/api/sessions", (req, body) => {
    const config = loadConfig();
    return store.createSession({ account: accountOf(req), workspace: body.workspace || config.workspace, model: body.model || config.model });
  });
  const ownSession = (req, id) => {
    const s = store.getSession(id);
    if (!s || s.account !== accountOf(req)) throw Object.assign(new Error("Session not found"), { status: 404 });
    return s;
  };
  route("GET", "/api/sessions/:id", (req, body, q, p) => ownSession(req, p.id));
  route("PATCH", "/api/sessions/:id", (req, body, q, p) => {
    const s = ownSession(req, p.id);
    for (const k of ["title", "model", "pinned", "workspace"]) if (k in body) s[k] = body[k];
    store.saveSession(s);
    return s;
  });
  route("DELETE", "/api/sessions/:id", (req, body, q, p) => {
    ownSession(req, p.id);
    store.deleteSession(p.id);
    return { ok: true };
  });

  route("POST", "/api/sessions/:id/run", async (req, body, q, p, res) => {
    const session = ownSession(req, p.id);
    if ([...runs.values()].some((r) => r.sessionId === session.id)) throw Object.assign(new Error("This session is already running"), { status: 409 });
    const runId = crypto.randomBytes(8).toString("hex");
    const controller = new AbortController();
    const run = { controller, approvals: new Map(), sessionId: session.id };
    runs.set(runId, run);

    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    const send = (e) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    send({ type: "run_start", runId });
    const ping = setInterval(() => res.write(": ping\n\n"), 15_000);

    try {
      await harness.run(session, body.content, {
        signal: controller.signal,
        emit: send,
        approve: (r) =>
          new Promise((resolve) => {
            run.approvals.set(r.id, resolve);
            controller.signal.addEventListener("abort", () => resolve("deny"), { once: true });
          }),
      });
    } catch (err) {
      send({ type: "error", message: err.message });
    } finally {
      clearInterval(ping);
      runs.delete(runId);
      res.end();
    }
    return undefined;
  });
  route("POST", "/api/runs/:id/approve", (req, body, q, p) => {
    const run = runs.get(p.id);
    const resolve = run?.approvals.get(body.toolId);
    if (!resolve) throw Object.assign(new Error("No pending approval"), { status: 404 });
    run.approvals.delete(body.toolId);
    resolve(body.decision);
    return { ok: true };
  });
  const idle = (id) => {
    if ([...runs.values()].some((r) => r.sessionId === id)) throw Object.assign(new Error("Stop the running turn first"), { status: 409 });
  };
  route("POST", "/api/sessions/:id/compact", async (req, body, q, p) => {
    const session = ownSession(req, p.id);
    idle(session.id);
    try {
      await harness.compact(session);
    } catch (err) {
      throw Object.assign(new Error(err.message), { status: 400 });
    }
    return session;
  });
  route("GET", "/api/sessions/:id/rewind", (req, body, q, p) => harness.rewindPreview(ownSession(req, p.id), Number(q.get("index"))));
  route("POST", "/api/sessions/:id/rewind", (req, body, q, p) => {
    const session = ownSession(req, p.id);
    idle(session.id);
    try {
      const result = harness.rewind(session, Number(body.index), body.mode || "both");
      return { ...result, session };
    } catch (err) {
      throw Object.assign(new Error(err.message), { status: 400 });
    }
  });
  route("POST", "/api/runs/:id/abort", (req, body, q, p) => {
    runs.get(p.id)?.controller.abort();
    return { ok: true };
  });

  /* ---------------------------------- skills --------------------------------- */
  route("GET", "/api/skills", () => listSkills(loadConfig()));
  route("GET", "/api/skills/:name", (req, body, q, p) => readSkill(loadConfig(), decodeURIComponent(p.name)));
  route("POST", "/api/skills", (req, body) => ({ name: saveSkill(body) }));
  route("DELETE", "/api/skills/:name", (req, body, q, p) => {
    deleteSkill(loadConfig(), decodeURIComponent(p.name));
    return { ok: true };
  });
  route("POST", "/api/skills/:name/toggle", (req, body, q, p) => {
    const name = decodeURIComponent(p.name);
    const config = loadConfig();
    const disabled = new Set(config.disabledSkills);
    disabled.has(name) ? disabled.delete(name) : disabled.add(name);
    saveConfig({ disabledSkills: [...disabled] });
    return listSkills(loadConfig());
  });

  /* ----------------------------------- MCP ----------------------------------- */
  route("GET", "/api/mcp", () => harness.mcp.status());
  route("GET", "/api/mcp/discover", () => discoverExternalMcp());
  route("POST", "/api/mcp/:name/reconnect", async (req, body, q, p) => {
    await harness.mcp.reconnect(decodeURIComponent(p.name));
    return harness.mcp.status();
  });

  /* ---------------------------------- stats ---------------------------------- */
  route("GET", "/api/stats", (req, body, q) => {
    const scope = q.get("scope");
    return store.readStats({ account: scope === "all" ? null : accountOf(req), days: Number(q.get("days") || 30) });
  });

  /* ------------------------------ files (IDE mode) ---------------------------- */
  const wsPath = (q, key = "path") => {
    const ws = path.resolve(q.get("workspace") || loadConfig().workspace);
    const target = path.resolve(ws, q.get(key) || ".");
    if (!isInside(ws, target)) throw Object.assign(new Error("Path outside workspace"), { status: 403 });
    return { ws, target };
  };
  route("GET", "/api/fs/list", (req, body, q) => {
    const { ws, target } = wsPath(q);
    const hidden = new Set([".git", "node_modules", ".DS_Store"]);
    return fs
      .readdirSync(target, { withFileTypes: true })
      .filter((e) => !hidden.has(e.name))
      .map((e) => ({ name: e.name, path: path.relative(ws, path.join(target, e.name)).replace(/\\/g, "/"), dir: e.isDirectory() }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  });
  route("GET", "/api/fs/file", (req, body, q) => {
    const { target } = wsPath(q);
    const stat = fs.statSync(target);
    if (stat.size > 3_000_000) throw Object.assign(new Error("File too large to open"), { status: 413 });
    return { content: fs.readFileSync(target, "utf8"), size: stat.size, mtime: stat.mtimeMs };
  });
  route("PUT", "/api/fs/file", (req, body, q) => {
    const { target } = wsPath(q);
    fs.writeFileSync(target, body.content);
    return { ok: true };
  });
  route("GET", "/api/fs/exists", (req, body, q) => {
    const dir = q.get("path");
    return { exists: Boolean(dir) && fs.existsSync(dir) && fs.statSync(dir).isDirectory() };
  });
  route("GET", "/api/git", (req, body, q) => {
    const ws = q.get("workspace") || loadConfig().workspace;
    return new Promise((resolve) => {
      execFile("git", ["status", "--porcelain=v1", "-b"], { cwd: ws, windowsHide: true }, (err, stdout) => {
        if (err) return resolve({ repo: false });
        const lines = stdout.trim().split("\n");
        const branch = (lines.shift() || "").replace(/^## /, "").split("...")[0];
        resolve({ repo: true, branch, changes: lines.filter(Boolean).map((l) => ({ status: l.slice(0, 2).trim(), path: l.slice(3) })) });
      });
    });
  });

  ideRoutes(route);

  /* --------------------------------- server ---------------------------------- */
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const origin = req.headers.origin;
    if (!originOk(origin)) {
      res.writeHead(403).end("Forbidden origin");
      return;
    }
    if (origin) {
      res.setHeader("access-control-allow-origin", origin);
      res.setHeader("access-control-allow-headers", "content-type, x-fish-account, x-fish-token");
      res.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE");
    }
    if (req.method === "OPTIONS") return res.writeHead(204).end();

    if (url.pathname.startsWith("/api/")) {
      const r = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
      if (!r) return json(res, 404, { error: "Not found" });
      const m = r.re.exec(url.pathname);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1]]));
      try {
        const body = ["POST", "PUT", "PATCH"].includes(req.method) ? await readBody(req) : {};
        const out = await r.handler(req, body, url.searchParams, params, res);
        if (out !== undefined && !res.headersSent) json(res, 200, out);
      } catch (err) {
        if (!res.headersSent) json(res, err.status || 500, { error: err.message });
        else res.end();
      }
      return;
    }
    serveStatic(url.pathname, res);
  });

  await attachTerminal(server, originOk);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  return {
    port: actualPort,
    url: `http://${host === "0.0.0.0" ? "localhost" : host}:${actualPort}`,
    close: async () => {
      await harness.mcp.closeAll();
      server.close();
    },
  };
}

// Only the app itself (served from localhost) may call the API.
function originOk(origin) {
  return !origin || /^(https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?|file:\/\/|null)$/.test(origin);
}

function json(res, status, data) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(Object.assign(new Error("Invalid JSON body"), { status: 400 }));
      }
    });
    req.on("error", reject);
  });
}

function serveStatic(pathname, res) {
  if (!fs.existsSync(UI_DIST)) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<body style="background:#0f0f0f;color:#d4d4d4;font-family:system-ui;padding:40px"><h2>Fish Harness server is running</h2><p>UI is not built yet. Run <code>npm run build</code>, or <code>npm run dev</code> for development.</p></body>`);
    return;
  }
  let file = path.join(UI_DIST, decodeURIComponent(pathname));
  if (!isInside(UI_DIST, file) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(UI_DIST, "index.html");
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}
