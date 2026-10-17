import fs from "node:fs";
import path from "node:path";
import { loadConfig, getProvider } from "./config.js";
import { BUILTIN_TOOLS, validateInput, isInside, defaultShell } from "./tools.js";
import { promptVars, renderTemplate, activeTemplate } from "./prompt.js";
import { McpManager } from "./mcp.js";
import { applyProxy } from "./net.js";
import { findModel, costOf } from "./models.js";
import { anthropicTurn, openAiTurn, quickText, isRetryableParseError, describeApiError } from "./providers.js";
import { saveSession, recordStat } from "./store.js";

/* --------------------------------- subagents --------------------------------- */

const SUBAGENT_TOOLS = ["Read", "Glob", "Grep", "ListDir", "WebFetch", "Skill"];

export const TASK_TOOL = {
  name: "Task",
  kind: "agent",
  description:
    "Launch a subagent that investigates with read-only tools (Read, Glob, Grep, ListDir, WebFetch) and returns a written report. " +
    "Use it to explore several areas in parallel or to keep large searches out of your own context: put several Task calls in one response and they run at the same time. " +
    "Give each a complete, self-contained brief — the subagent cannot see this conversation and cannot edit files.",
  input_schema: {
    type: "object",
    properties: {
      description: { type: "string", description: "3–6 word label shown to the user, e.g. 'Map the auth flow'." },
      prompt: { type: "string", description: "Full task for the subagent, including what to report back." },
      model: { type: "string", enum: ["same", "fast"], description: "'fast' uses a cheaper model for simple lookups. Default 'same'." },
    },
    required: ["description", "prompt"],
  },
};

const SUBAGENT_PROMPT = `You are a Fish subagent: a focused research assistant working for the main Fish agent.
Investigate the task with your read-only tools, then write your final answer as a complete, concise report — it is returned verbatim to the main agent, which cannot see your tool calls.
Cite file paths with line numbers. Do not ask questions; if something is ambiguous, state your assumption. You cannot edit files or run commands.`;

/* -------------------------------- compaction -------------------------------- */

const SUMMARY_PROMPT = `You compress a coding-agent conversation so the agent can keep working after older turns are dropped.
Write a dense summary with these sections:
## Goal — what the user wants overall.
## Done so far — decisions made and files created or changed (paths).
## Current state — what works, what is broken, open errors.
## Next steps — what the agent was about to do.
Keep exact file paths, names and numbers. No preamble.`;

function transcriptText(messages, limit = 120_000) {
  const out = [];
  for (const m of messages) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
    for (const b of blocks) {
      if (b.type === "text" && b.text) out.push(`${m.role.toUpperCase()}: ${b.text}`);
      else if (b.type === "tool_use") out.push(`TOOL CALL ${b.name}: ${JSON.stringify(b.input).slice(0, 400)}`);
      else if (b.type === "tool_result") {
        const text = typeof b.content === "string" ? b.content : (b.content || []).map((c) => c.text || "").join("\n");
        out.push(`TOOL RESULT${b.is_error ? " (error)" : ""}: ${text.slice(0, 600)}`);
      } else if (b.type === "image") out.push(`${m.role.toUpperCase()}: [image]`);
      else if (b.type === "document") out.push(`${m.role.toUpperCase()}: [file ${b.title || ""}]`);
    }
  }
  const text = out.join("\n");
  return text.length > limit ? `…\n${text.slice(-limit)}` : text;
}

const textOf = (content) =>
  typeof content === "string" ? content : (content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");

/** A user message the person typed (not a tool_result carrier). */
export const isPromptMessage = (m) =>
  m?.role === "user" && (typeof m.content === "string" || m.content.some((b) => b.type === "text" || b.type === "image" || b.type === "document"));

export class Harness {
  constructor() {
    this.mcp = new McpManager();
  }

  get config() {
    return loadConfig();
  }

  async init() {
    applyProxy(this.config);
    await this.mcp.sync(this.config.mcpServers);
  }

  tools({ subagent = false } = {}) {
    const disabled = new Set(this.config.disabledTools || []);
    if (subagent) return BUILTIN_TOOLS.filter((t) => SUBAGENT_TOOLS.includes(t.name) && !disabled.has(t.name));
    const builtins = BUILTIN_TOOLS.filter((t) => !disabled.has(t.name));
    const task = disabled.has("Task") ? [] : [TASK_TOOL];
    const mcp = this.mcp.toolDefs().map((d) => ({ ...d, kind: "mcp" }));
    return [...builtins, ...task, ...mcp];
  }

  promptVars(workspace) {
    return promptVars(this.config, workspace, this.tools().map((t) => t.name));
  }

  /** Assemble the system prompt; `template` overrides the saved one (Dev-Mode preview). */
  buildSystemPrompt(workspace, template) {
    return renderTemplate(template ?? activeTemplate(this.config), this.promptVars(workspace));
  }

  needsApproval(tool, input, session) {
    const mode = this.config.permissionMode;
    if (tool.kind === "read" || tool.kind === "meta" || tool.kind === "agent") return false;
    if (mode === "yolo") return false;
    if (session.allowedTools?.includes(tool.name)) return false;
    if (tool.kind === "write") {
      const target = path.resolve(session.workspace, input.file_path || "");
      if (!isInside(session.workspace, target)) return true;
      return mode !== "auto-edit";
    }
    return true;
  }

  resolveModel(modelId) {
    const config = this.config;
    const modelInfo = findModel(modelId, config);
    const provider = getProvider(config, modelInfo.provider) || getProvider(config, "anthropic");
    return { modelInfo, provider };
  }

  /** Claude catalog models compact server-side; everything else uses our summary. */
  nativeCompaction(modelInfo, provider) {
    return provider.type === "anthropic" && !modelInfo.custom && (this.config.autoCompactTokens ?? 150000) > 0;
  }

  /**
   * Run one user turn to completion.
   * @param {object} session  persisted session (mutated + saved)
   * @param {string|Array} userContent
   * @param {{ emit: Function, signal?: AbortSignal, approve: (req) => Promise<"allow"|"allow_always"|"deny"> }} io
   */
  async run(session, userContent, io) {
    const config = this.config;
    session.workspace = session.workspace || config.workspace;
    const modelId = session.model || config.model;
    const { modelInfo, provider } = this.resolveModel(modelId);

    const promptText = typeof userContent === "string" ? userContent : textOf(userContent);
    if (session.title === "New session" && promptText.trim()) {
      session.title = promptText.replace(/\s+/g, " ").trim().slice(0, 60) || "New session";
      io.emit({ type: "title", title: session.title });
    }

    // Client-side auto-compaction for providers without server-side compaction.
    const threshold = config.autoCompactTokens ?? 150000;
    if (threshold > 0 && !this.nativeCompaction(modelInfo, provider) && (session.lastContext || 0) > threshold) {
      io.emit({ type: "notice", text: "Context is large — summarizing earlier turns…" });
      try {
        await this.compact(session);
        io.emit({ type: "compacted", session });
      } catch (err) {
        io.emit({ type: "notice", text: `Auto-compact failed: ${err.message}` });
      }
    }

    session.messages.push({ role: "user", content: userContent });
    const turn = session.messages.length - 1;
    saveSession(session);
    await this.loop(session, io, { modelId, modelInfo, provider, turn });
    saveSession(session);
    io.emit({ type: "done", usage: session.usage });
  }

  /** The request → tools → request loop shared by the main agent and subagents. */
  async loop(session, io, { modelId, modelInfo, provider, turn, subagent = false }) {
    const { emit, signal } = io;
    const config = this.config;
    const workspace = session.workspace;
    const turnFn = provider.type === "openai" ? openAiTurn : anthropicTurn;
    const persist = () => !subagent && saveSession(session);

    const ctx = {
      cwd: workspace,
      signal,
      config: { ...config, workspace },
      emit: (e) => {
        if (e.type === "todos") session.todos = e.todos;
        if (e.type === "file_changed") session.changes.push({ path: e.path, before: e.before, after: e.after, ts: Date.now(), turn });
        emit(e);
      },
    };

    let parseRetries = 0;
    while (true) {
      if (signal?.aborted) break;
      const tools = this.tools({ subagent });
      let system;
      if (subagent) {
        system = `${SUBAGENT_PROMPT}\n\n# Environment\n- Workspace: ${workspace}\n- Platform: ${process.platform}\n- Date: ${new Date().toISOString().slice(0, 10)}`;
      } else {
        const base = this.buildSystemPrompt(workspace);
        system = modelInfo.persona ? `${modelInfo.persona}\n\n${base}` : base;
      }
      const started = Date.now();
      emit({ type: "request_start", model: modelId });

      let message;
      try {
        message = await turnFn({
          provider,
          model: modelInfo.apiId || modelId,
          modelInfo,
          system,
          messages: session.messages,
          tools,
          config: { ...config, compaction: this.nativeCompaction(modelInfo, provider), webSearch: subagent ? false : config.webSearch },
          signal,
          onEvent: (e) => emit({ type: "stream", ...e }),
        });
        parseRetries = 0;
      } catch (err) {
        if (signal?.aborted) break;
        if (isRetryableParseError(err) && parseRetries++ < 2) {
          emit({ type: "notice", text: "Tool input was not valid JSON — retrying the turn." });
          continue;
        }
        recordStat({ type: "error", account: session.account, session: session.id, model: modelId, message: err.message });
        emit({ type: "error", message: describeApiError(err) });
        break;
      }

      const usage = message.usage || {};
      const cost = costOf(modelInfo, usage);
      session.usage.input += usage.input_tokens || 0;
      session.usage.output += usage.output_tokens || 0;
      session.usage.cacheRead += usage.cache_read_input_tokens || 0;
      session.usage.cacheWrite += usage.cache_creation_input_tokens || 0;
      session.usage.cost += cost;
      session.lastContext = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
      recordStat({
        type: "request",
        account: session.account,
        session: session.id,
        model: modelInfo.custom ? modelId : message.model || modelId,
        provider: provider.id,
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
        cacheWrite: usage.cache_creation_input_tokens || 0,
        cost,
        durationMs: Date.now() - started,
        stop: message.stop_reason,
        ...(subagent ? { subagent: true } : {}),
      });

      // Append the full content: compaction and thinking blocks must be sent back unchanged.
      const assistant = { role: "assistant", content: message.content };
      session.messages.push(assistant);
      persist();
      emit({ type: "assistant_message", message: assistant, usage: session.usage, context: session.lastContext, stop: message.stop_reason });

      if (message.stop_reason === "refusal") {
        emit({ type: "notice", text: "The model declined this request." });
        break;
      }
      if (message.stop_reason === "pause_turn") continue;

      const toolUses = message.content.filter((b) => b.type === "tool_use");
      if (!toolUses.length) break;
      if (message.stop_reason === "max_tokens") {
        const results = toolUses.map((t) => ({ type: "tool_result", tool_use_id: t.id, is_error: true, content: "Tool input was truncated at max_tokens; not executed." }));
        session.messages.push({ role: "user", content: results });
        persist();
        emit({ type: "error", message: "Response hit max_tokens mid tool call. Raise Max tokens in Settings." });
        break;
      }

      const results = await this.runTools(toolUses, tools, session, ctx, io, { subagent });
      const toolMsg = { role: "user", content: results };
      session.messages.push(toolMsg);
      persist();
      emit({ type: "tool_results", message: toolMsg, todos: session.todos });
      if (signal?.aborted) break;
    }
  }

  async runTools(toolUses, tools, session, ctx, io, { subagent = false } = {}) {
    const { emit, signal, approve } = io;
    const runOne = async (use) => {
      const tool = tools.find((t) => t.name === use.name);
      let started = Date.now();
      const finish = (content, isError = false) => {
        recordStat({ type: "tool", account: session.account, session: session.id, tool: use.name, durationMs: Date.now() - started, error: isError });
        emit({ type: "tool_done", id: use.id, name: use.name, isError, content, ms: Date.now() - started });
        return { type: "tool_result", tool_use_id: use.id, content: String(content), ...(isError ? { is_error: true } : {}) };
      };

      if (signal?.aborted) return finish("Interrupted by user.", true);
      if (!tool) return finish(`Unknown tool: ${use.name}`, true);
      const invalid = validateInput(tool.input_schema, use.input);
      if (invalid) return finish(`INVALID_INPUT: ${invalid}. Re-issue the call with valid JSON.`, true);

      if (this.config.permissionMode === "plan" && (tool.kind === "write" || tool.kind === "exec")) {
        return finish("Plan mode is on: this tool is disabled. Present your plan instead.", true);
      }
      if (!subagent && this.needsApproval(tool, use.input, session)) {
        emit({ type: "permission_request", id: use.id, name: use.name, input: use.input, kind: tool.kind });
        const decision = await approve({ id: use.id, name: use.name, input: use.input });
        emit({ type: "permission_resolved", id: use.id, decision });
        if (decision === "allow_always") (session.allowedTools ||= []).push(use.name);
        if (decision === "deny") return finish("The user denied this tool call. Ask how they want to proceed.", true);
        started = Date.now();
      }

      emit({ type: "tool_start", id: use.id, name: use.name, input: use.input });
      try {
        if (tool.kind === "agent") {
          const report = await this.runSubagent(session, use, io);
          return finish(report.text, report.isError);
        }
        if (tool.kind === "mcp") {
          const r = await this.mcp.call(use.name, use.input);
          return finish(r.content, r.isError);
        }
        const toolCtx = { ...ctx, emit: (e) => ctx.emit({ ...e, toolId: use.id }) };
        return finish(await tool.run(use.input, toolCtx));
      } catch (err) {
        return finish(`Error: ${err.message}`, true);
      }
    };

    const parallel = toolUses.every((u) => {
      const t = tools.find((x) => x.name === u.name);
      return t && ["read", "meta", "agent"].includes(t.kind);
    });
    if (parallel) return Promise.all(toolUses.map(runOne));
    const results = [];
    for (const use of toolUses) results.push(await runOne(use));
    return results;
  }

  /** Run a read-only subagent for a Task call and return its final report. */
  async runSubagent(parent, use, io) {
    const config = this.config;
    let modelId = parent.model || config.model;
    let { modelInfo, provider } = this.resolveModel(modelId);
    if (use.input.model === "fast" && provider.type === "anthropic" && !modelInfo.custom) {
      modelId = "claude-haiku-5-5";
      ({ modelInfo, provider } = this.resolveModel(modelId));
    }
    const sub = {
      id: parent.id,
      account: parent.account,
      workspace: parent.workspace,
      model: modelId,
      messages: [{ role: "user", content: use.input.prompt }],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
      changes: [],
      todos: [],
    };
    const calls = [];
    const forward = (e) => {
      if (e.type === "tool_start") calls.push({ id: e.id, name: e.name, input: e.input });
      if (e.type === "tool_done") Object.assign(calls.find((c) => c.id === e.id) || {}, { isError: e.isError, ms: e.ms });
      if (["tool_start", "tool_done", "request_start", "error"].includes(e.type) || (e.type === "stream" && (e.text || e.block))) {
        io.emit({ type: "sub", parent: use.id, event: e.type === "tool_done" ? { ...e, content: String(e.content).slice(0, 300) } : e });
      }
    };
    await this.loop(sub, { emit: forward, signal: io.signal, approve: async () => "deny" }, { modelId, modelInfo, provider, turn: -1, subagent: true });

    for (const k of Object.keys(parent.usage)) parent.usage[k] += sub.usage[k] || 0;
    const last = [...sub.messages].reverse().find((m) => m.role === "assistant");
    const text = textOf(last?.content).trim();
    (parent.subagents ||= {})[use.id] = {
      description: use.input.description,
      model: modelId,
      calls: calls.map((c) => ({ name: c.name, input: c.input, isError: c.isError })),
      cost: sub.usage.cost,
    };
    return text ? { text, isError: false } : { text: "The subagent finished without a report.", isError: true };
  }

  /**
   * Summarize the conversation and continue from the summary. Older messages
   * move to session.archive so the UI can still show them.
   */
  async compact(session, { signal } = {}) {
    if (session.messages.length < 4) throw new Error("Nothing to compact yet");
    const { modelInfo, provider } = this.resolveModel(session.model || this.config.model);
    const summary = await quickText({
      provider,
      modelInfo,
      system: SUMMARY_PROMPT,
      prompt: transcriptText(session.messages),
      maxTokens: 4000,
      signal,
    });
    if (!summary.trim()) throw new Error("The model returned an empty summary");
    session.archive = [...(session.archive || []), ...session.messages.slice(session.summaryLength || 0)];
    session.messages = [
      { role: "user", content: `<conversation-summary>\n${summary.trim()}\n</conversation-summary>\n\nEarlier turns were summarized above. Continue the work from here.` },
      { role: "assistant", content: [{ type: "text", text: "Got it — I have the context from the summary and will continue from here." }] },
    ];
    session.summaryLength = 2;
    session.summary = summary.trim();
    session.compactions = (session.compactions || 0) + 1;
    session.lastContext = Math.round(summary.length / 4);
    // Old checkpoints point into the archived history; they can no longer be rewound to.
    for (const c of session.changes) c.turn = -1;
    saveSession(session);
    return session;
  }

  /**
   * Rewind to just before the user message at `index`.
   * mode: "both" (files + conversation), "conversation", or "files".
   */
  rewind(session, index, mode = "both") {
    const msg = session.messages[index];
    if (!isPromptMessage(msg) || index < (session.summaryLength || 0)) throw new Error("That message can't be rewound to");
    const reverted = [];
    if (mode !== "conversation") {
      const later = session.changes.filter((c) => c.turn >= index);
      for (const c of [...later].reverse()) {
        try {
          if (c.before === null) fs.rmSync(c.path, { force: true });
          else {
            fs.mkdirSync(path.dirname(c.path), { recursive: true });
            fs.writeFileSync(c.path, c.before);
          }
          if (!reverted.includes(c.path)) reverted.push(c.path);
        } catch {}
      }
      session.changes = session.changes.filter((c) => !(c.turn >= index));
    }
    if (mode !== "files") {
      session.messages = session.messages.slice(0, index);
      session.todos = [];
      // Changes from rewound turns stay recorded but are no longer tied to a message.
      for (const c of session.changes) if (c.turn >= index) c.turn = -1;
    }
    saveSession(session);
    return { reverted, prompt: msg.content };
  }

  /** Files a rewind to `index` would touch, plus whether shell commands ran since. */
  rewindPreview(session, index) {
    const files = [...new Set(session.changes.filter((c) => c.turn >= index).map((c) => c.path))];
    const shell = session.messages.slice(index).some((m) => m.role === "assistant" && Array.isArray(m.content) && m.content.some((b) => b.type === "tool_use" && b.name === "Shell"));
    return { files, shell, shellLabel: defaultShell().label };
  }
}
