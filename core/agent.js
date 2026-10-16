import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, getProvider, resolveBasePrompt } from "./config.js";
import { BUILTIN_TOOLS, validateInput, isInside, defaultShell } from "./tools.js";
import { listSkills } from "./skills.js";
import { McpManager } from "./mcp.js";
import { findModel, costOf } from "./models.js";
import { anthropicTurn, openAiTurn, isRetryableParseError, describeApiError } from "./providers.js";
import { saveSession, recordStat } from "./store.js";

const PROJECT_FILES = ["FISH.md", "AGENTS.md", "CLAUDE.md", ".cursorrules"];

export class Harness {
  constructor() {
    this.mcp = new McpManager();
  }

  get config() {
    return loadConfig();
  }

  async init() {
    await this.mcp.sync(this.config.mcpServers);
  }

  tools() {
    const disabled = new Set(this.config.disabledTools || []);
    const builtins = BUILTIN_TOOLS.filter((t) => !disabled.has(t.name));
    const mcp = this.mcp.toolDefs().map((d) => ({ ...d, kind: "mcp" }));
    return [...builtins, ...mcp];
  }

  buildSystemPrompt(workspace) {
    const config = this.config;
    const parts = [resolveBasePrompt(config)];
    const shell = defaultShell();
    parts.push(
      `# Environment\n- Workspace: ${workspace}\n- Platform: ${process.platform} (${os.release()})\n- Shell tool runs: ${shell.label}\n- Date: ${new Date().toISOString().slice(0, 10)}`,
    );
    const skills = listSkills({ ...config, workspace }).filter((s) => s.enabled);
    if (skills.length) {
      parts.push(
        `# Skills\nSkills are packaged instructions. When a task matches one, call the Skill tool with its name first and follow what it returns.\n${skills
          .map((s) => `- ${s.name}: ${s.description}`)
          .join("\n")}`,
      );
    }
    for (const name of PROJECT_FILES) {
      const file = path.join(workspace, name);
      if (fs.existsSync(file)) {
        parts.push(`# Project instructions (${name})\n${fs.readFileSync(file, "utf8").slice(0, 20_000)}`);
        break;
      }
    }
    if (config.permissionMode === "plan") {
      parts.push("# Plan mode\nYou are in plan mode: investigate with read-only tools and present a plan. Do not modify files or run commands that change state.");
    }
    if (config.appendPrompt?.trim()) parts.push(config.appendPrompt.trim());
    return parts.join("\n\n");
  }

  needsApproval(tool, input, session) {
    const mode = this.config.permissionMode;
    if (tool.kind === "read" || tool.kind === "meta") return false;
    if (mode === "yolo") return false;
    if (session.allowedTools?.includes(tool.name)) return false;
    if (tool.kind === "write") {
      const target = path.resolve(session.workspace, input.file_path || "");
      if (!isInside(session.workspace, target)) return true;
      return mode !== "auto-edit";
    }
    return true;
  }

  /**
   * Run one user turn to completion.
   * @param {object} session  persisted session (mutated + saved)
   * @param {string|Array} userContent
   * @param {{ emit: Function, signal?: AbortSignal, approve: (req) => Promise<"allow"|"allow_always"|"deny"> }} io
   */
  async run(session, userContent, { emit, signal, approve }) {
    const config = this.config;
    const workspace = session.workspace || config.workspace;
    session.workspace = workspace;
    const modelId = session.model || config.model;
    const modelInfo = findModel(modelId, config);
    const provider = getProvider(config, modelInfo.provider) || getProvider(config, "anthropic");
    const turnFn = provider.type === "openai" ? openAiTurn : anthropicTurn;

    if (session.title === "New session" && typeof userContent === "string") {
      session.title = userContent.replace(/\s+/g, " ").trim().slice(0, 60) || "New session";
      emit({ type: "title", title: session.title });
    }
    session.messages.push({ role: "user", content: userContent });
    saveSession(session);

    const ctx = {
      cwd: workspace,
      signal,
      config: { ...config, workspace },
      emit: (e) => {
        if (e.type === "todos") session.todos = e.todos;
        if (e.type === "file_changed") session.changes.push({ path: e.path, before: e.before, after: e.after, ts: Date.now() });
        emit(e);
      },
    };

    let parseRetries = 0;
    while (true) {
      if (signal?.aborted) break;
      const tools = this.tools();
      const system = this.buildSystemPrompt(workspace);
      const started = Date.now();
      emit({ type: "request_start", model: modelId });

      let message;
      try {
        message = await turnFn({
          provider,
          model: modelId,
          modelInfo,
          system,
          messages: session.messages,
          tools,
          config,
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
        model: message.model || modelId,
        provider: provider.id,
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
        cacheRead: usage.cache_read_input_tokens || 0,
        cacheWrite: usage.cache_creation_input_tokens || 0,
        cost,
        durationMs: Date.now() - started,
        stop: message.stop_reason,
      });

      const assistant = { role: "assistant", content: message.content };
      session.messages.push(assistant);
      saveSession(session);
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
        saveSession(session);
        emit({ type: "error", message: "Response hit max_tokens mid tool call. Raise Max tokens in Settings." });
        break;
      }

      const results = await this.runTools(toolUses, tools, session, ctx, { emit, signal, approve });
      const toolMsg = { role: "user", content: results };
      session.messages.push(toolMsg);
      saveSession(session);
      emit({ type: "tool_results", message: toolMsg, todos: session.todos });
      if (signal?.aborted) break;
    }

    saveSession(session);
    emit({ type: "done", usage: session.usage });
  }

  async runTools(toolUses, tools, session, ctx, { emit, signal, approve }) {
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
      if (this.needsApproval(tool, use.input, session)) {
        emit({ type: "permission_request", id: use.id, name: use.name, input: use.input, kind: tool.kind });
        const decision = await approve({ id: use.id, name: use.name, input: use.input });
        emit({ type: "permission_resolved", id: use.id, decision });
        if (decision === "allow_always") (session.allowedTools ||= []).push(use.name);
        if (decision === "deny") return finish("The user denied this tool call. Ask how they want to proceed.", true);
        started = Date.now();
      }

      emit({ type: "tool_start", id: use.id, name: use.name, input: use.input });
      try {
        const toolCtx = { ...ctx, emit: (e) => ctx.emit({ ...e, toolId: use.id }) };
        if (tool.kind === "mcp") {
          const r = await this.mcp.call(use.name, use.input);
          return finish(r.content, r.isError);
        }
        return finish(await tool.run(use.input, toolCtx));
      } catch (err) {
        return finish(`Error: ${err.message}`, true);
      }
    };

    const allSafe = toolUses.every((u) => {
      const t = tools.find((x) => x.name === u.name);
      return t && (t.kind === "read" || t.kind === "meta");
    });
    if (allSafe) return Promise.all(toolUses.map(runOne));
    const results = [];
    for (const use of toolUses) results.push(await runOne(use));
    return results;
  }
}
