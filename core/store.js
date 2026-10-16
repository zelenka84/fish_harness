import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { paths, readJson, writeJson, ensureDirs } from "./paths.js";

const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(4).toString("hex")}`;

/* ---------------------------------- sessions --------------------------------- */

export function createSession({ account = "local", workspace, model, title } = {}) {
  ensureDirs();
  const session = {
    id: newId("s"),
    account,
    title: title || "New session",
    workspace,
    model,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [], // Anthropic-format history, append-only
    todos: [],
    changes: [], // { path, before, after, ts }
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
    pinned: false,
  };
  saveSession(session);
  return session;
}

export function sessionFile(id) {
  if (!/^[a-z0-9_]+$/i.test(id)) throw new Error("bad session id");
  return path.join(paths.sessions, `${id}.json`);
}

export function getSession(id) {
  return readJson(sessionFile(id), null);
}

export function saveSession(session) {
  session.updatedAt = Date.now();
  writeJson(sessionFile(session.id), session);
}

export function deleteSession(id) {
  fs.rmSync(sessionFile(id), { force: true });
}

export function listSessions(account) {
  ensureDirs();
  const out = [];
  for (const f of fs.readdirSync(paths.sessions)) {
    if (!f.endsWith(".json")) continue;
    const s = readJson(path.join(paths.sessions, f), null);
    if (!s || (account && s.account !== account)) continue;
    const last = [...s.messages].reverse().find((m) => m.role === "user" && typeof m.content === "string");
    out.push({
      id: s.id,
      title: s.title,
      workspace: s.workspace,
      model: s.model,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      pinned: s.pinned,
      turns: s.messages.filter((m) => m.role === "user" && typeof m.content === "string").length,
      preview: last?.content?.slice(0, 140) || "",
      cost: s.usage?.cost || 0,
    });
  }
  return out.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
}

/* ----------------------------------- stats ----------------------------------- */

export function recordStat(event) {
  ensureDirs();
  fs.appendFileSync(paths.stats, JSON.stringify({ ts: Date.now(), ...event }) + "\n");
}

export function readStats({ account, days = 30 } = {}) {
  let lines = [];
  try {
    lines = fs.readFileSync(paths.stats, "utf8").split("\n");
  } catch {}
  const since = days ? Date.now() - days * 86_400_000 : 0;
  const events = [];
  for (const line of lines) {
    if (!line) continue;
    try {
      const e = JSON.parse(line);
      if (e.ts >= since && (!account || e.account === account)) events.push(e);
    } catch {}
  }
  return aggregate(events, days);
}

function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function aggregate(events, days) {
  const totals = { requests: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, toolCalls: 0, durationMs: 0, errors: 0 };
  const byDay = new Map();
  const byModel = {};
  const byTool = {};
  const sessions = new Set();
  const hours = Array(24).fill(0);

  const span = Math.max(1, days || 30);
  for (let i = span - 1; i >= 0; i--) {
    const k = dayKey(Date.now() - i * 86_400_000);
    byDay.set(k, { day: k, requests: 0, input: 0, output: 0, cost: 0, toolCalls: 0 });
  }

  for (const e of events) {
    if (e.type === "tool") {
      totals.toolCalls++;
      const t = (byTool[e.tool] ||= { calls: 0, errors: 0, ms: 0 });
      t.calls++;
      t.ms += e.durationMs || 0;
      if (e.error) t.errors++;
      const d = byDay.get(dayKey(e.ts));
      if (d) d.toolCalls++;
      continue;
    }
    if (e.type === "error") {
      totals.errors++;
      continue;
    }
    if (e.type !== "request") continue;
    totals.requests++;
    totals.input += e.input || 0;
    totals.output += e.output || 0;
    totals.cacheRead += e.cacheRead || 0;
    totals.cacheWrite += e.cacheWrite || 0;
    totals.cost += e.cost || 0;
    totals.durationMs += e.durationMs || 0;
    if (e.session) sessions.add(e.session);
    hours[new Date(e.ts).getHours()]++;
    const m = (byModel[e.model] ||= { requests: 0, input: 0, output: 0, cost: 0 });
    m.requests++;
    m.input += e.input || 0;
    m.output += e.output || 0;
    m.cost += e.cost || 0;
    const d = byDay.get(dayKey(e.ts));
    if (d) {
      d.requests++;
      d.input += e.input || 0;
      d.output += e.output || 0;
      d.cost += e.cost || 0;
    }
  }
  const promptTokens = totals.input + totals.cacheRead + totals.cacheWrite;
  return {
    totals: {
      ...totals,
      sessions: sessions.size,
      cacheHitRate: promptTokens ? totals.cacheRead / promptTokens : 0,
      avgLatencyMs: totals.requests ? totals.durationMs / totals.requests : 0,
    },
    days: [...byDay.values()],
    models: byModel,
    tools: byTool,
    hours,
  };
}

/* ---------------------------------- accounts --------------------------------- */

const COLORS = ["#2dd4bf", "#818cf8", "#f472b6", "#fbbf24", "#60a5fa", "#a3e635", "#fb7185"];

function loadAccounts() {
  const data = readJson(paths.accounts, null);
  if (data?.accounts?.length) return data;
  const seeded = {
    accounts: [{ id: "local", name: "Local", email: "", color: COLORS[0], createdAt: Date.now(), password: null }],
  };
  writeJson(paths.accounts, seeded);
  return seeded;
}

export function listAccounts() {
  return loadAccounts().accounts.map(({ password, ...a }) => ({ ...a, protected: Boolean(password) }));
}

function hashPassword(pw, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function createAccount({ name, email = "", password = "" }) {
  const data = loadAccounts();
  const account = {
    id: newId("u"),
    name: String(name || "User").slice(0, 40),
    email,
    color: COLORS[data.accounts.length % COLORS.length],
    createdAt: Date.now(),
    password: password ? hashPassword(password) : null,
  };
  data.accounts.push(account);
  writeJson(paths.accounts, data);
  const { password: _, ...pub } = account;
  return { ...pub, protected: Boolean(password) };
}

export function updateAccount(id, patch) {
  const data = loadAccounts();
  const acc = data.accounts.find((a) => a.id === id);
  if (!acc) throw new Error("No such account");
  if (patch.name) acc.name = String(patch.name).slice(0, 40);
  if (patch.email !== undefined) acc.email = patch.email;
  if (patch.color) acc.color = patch.color;
  if (patch.password !== undefined) acc.password = patch.password ? hashPassword(patch.password) : null;
  writeJson(paths.accounts, data);
}

export function deleteAccount(id) {
  const data = loadAccounts();
  if (data.accounts.length <= 1) throw new Error("Cannot delete the last account");
  data.accounts = data.accounts.filter((a) => a.id !== id);
  writeJson(paths.accounts, data);
}

export function verifyAccount(id, password) {
  const acc = loadAccounts().accounts.find((a) => a.id === id);
  if (!acc) return false;
  if (!acc.password) return true;
  const [salt, hash] = acc.password.split(":");
  const test = crypto.scryptSync(String(password || ""), salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, "hex"));
}
