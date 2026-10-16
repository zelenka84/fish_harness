import { useSyncExternalStore } from "react";
import { api, streamRun } from "./api.js";

/**
 * Holds open sessions and their live run state outside React so the chat
 * panel in Code mode and the agent panel in IDE mode share one source.
 */
const sessions = new Map(); // id -> { session, live, running, runId, tools, approvals, notices, error }
const listeners = new Set();
let version = 0;
const fileListeners = new Set();

function emit() {
  version++;
  listeners.forEach((l) => l());
}

export function subscribe(l) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function onFileChanged(fn) {
  fileListeners.add(fn);
  return () => fileListeners.delete(fn);
}

function blank(session) {
  return { session, live: [], running: false, runId: null, tools: {}, approvals: {}, notices: [], controller: null, startedAt: 0 };
}

export function useAgent(id) {
  useSyncExternalStore(subscribe, () => version);
  return id ? sessions.get(id) : null;
}

export async function loadSession(id) {
  const existing = sessions.get(id);
  if (existing?.running) return existing;
  const session = await api(`/sessions/${id}`);
  const entry = existing ? { ...existing, session } : blank(session);
  sessions.set(id, entry);
  emit();
  return entry;
}

export function patchLocalSession(id, patch) {
  const e = sessions.get(id);
  if (!e) return;
  e.session = { ...e.session, ...patch };
  emit();
}

export async function send(id, content, { onTitle, onDone } = {}) {
  const e = sessions.get(id);
  if (!e || e.running) return;
  e.running = true;
  e.startedAt = Date.now();
  e.live = [];
  e.notices = [];
  e.session = { ...e.session, messages: [...e.session.messages, { role: "user", content }] };
  e.controller = new AbortController();
  emit();

  try {
    await streamRun(
      id,
      content,
      (ev) => {
        handleEvent(e, ev, onTitle);
        emit();
      },
      e.controller.signal,
    );
  } catch (err) {
    if (err.name !== "AbortError") e.notices.push({ kind: "error", text: err.message });
  }
  e.running = false;
  e.runId = null;
  e.live = [];
  e.approvals = {};
  emit();
  onDone?.();
}

function handleEvent(e, ev, onTitle) {
  switch (ev.type) {
    case "run_start":
      e.runId = ev.runId;
      break;
    case "title":
      e.session = { ...e.session, title: ev.title };
      onTitle?.(ev.title);
      break;
    case "request_start":
      e.live = [];
      break;
    case "stream": {
      if (ev.block) {
        e.live[ev.index] = { ...ev.block, text: ev.block.text || "", thinking: "", partial: "" };
      } else if (e.live[ev.index]) {
        const b = e.live[ev.index];
        if (ev.type === "stream" && ev.partial !== undefined) b.partial += ev.partial;
        else if (b.type === "thinking") b.thinking += ev.text || "";
        else if (ev.text !== undefined) b.text += ev.text;
      }
      e.live = [...e.live];
      break;
    }
    case "assistant_message":
      e.session = { ...e.session, messages: [...e.session.messages, ev.message], usage: ev.usage, lastContext: ev.context };
      e.live = [];
      break;
    case "tool_results":
      e.session = { ...e.session, messages: [...e.session.messages, ev.message], todos: ev.todos ?? e.session.todos };
      break;
    case "permission_request":
      e.approvals = { ...e.approvals, [ev.id]: ev };
      break;
    case "permission_resolved": {
      const { [ev.id]: _, ...rest } = e.approvals;
      e.approvals = rest;
      break;
    }
    case "tool_start":
      e.tools = { ...e.tools, [ev.id]: { status: "running", output: "", started: Date.now() } };
      break;
    case "tool_output":
      if (ev.toolId && e.tools[ev.toolId]) {
        e.tools = { ...e.tools, [ev.toolId]: { ...e.tools[ev.toolId], output: (e.tools[ev.toolId].output + ev.text).slice(-20000) } };
      }
      break;
    case "tool_done":
      e.tools = { ...e.tools, [ev.id]: { ...(e.tools[ev.id] || {}), status: ev.isError ? "error" : "done", ms: ev.ms } };
      break;
    case "todos":
      e.session = { ...e.session, todos: ev.todos };
      break;
    case "file_changed":
      e.session = { ...e.session, changes: [...(e.session.changes || []), { path: ev.path, before: ev.before, after: ev.after, ts: Date.now() }] };
      fileListeners.forEach((fn) => fn(ev.path));
      break;
    case "notice":
      e.notices = [...e.notices, { kind: "info", text: ev.text }];
      break;
    case "error":
      e.notices = [...e.notices, { kind: "error", text: ev.message }];
      break;
    case "done":
      e.session = { ...e.session, usage: ev.usage };
      break;
  }
}

export async function approve(id, toolId, decision) {
  const e = sessions.get(id);
  if (!e?.runId) return;
  await api(`/runs/${e.runId}/approve`, { method: "POST", body: { toolId, decision } });
}

export async function stop(id) {
  const e = sessions.get(id);
  if (!e?.running) return;
  if (e.runId) await api(`/runs/${e.runId}/abort`, { method: "POST" }).catch(() => {});
}

export function forget(id) {
  sessions.delete(id);
  emit();
}
