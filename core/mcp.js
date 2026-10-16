import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

/**
 * Keeps one live MCP client per configured server and exposes their tools
 * to the agent as `mcp__<server>__<tool>`.
 */
export class McpManager {
  constructor() {
    this.servers = new Map(); // name -> { config, client, status, error, tools }
  }

  async sync(configs = []) {
    const wanted = new Map(configs.filter((c) => c.enabled !== false).map((c) => [c.name, c]));
    for (const [name, entry] of this.servers) {
      if (!wanted.has(name) || JSON.stringify(wanted.get(name)) !== JSON.stringify(entry.config)) {
        await this.disconnect(name);
      }
    }
    await Promise.all(
      [...wanted.values()].filter((c) => !this.servers.has(c.name)).map((c) => this.connect(c)),
    );
    for (const c of configs.filter((c) => c.enabled === false)) {
      this.servers.set(c.name, { config: c, status: "disabled", tools: [] });
    }
  }

  async connect(config) {
    const entry = { config, status: "connecting", tools: [], error: null };
    this.servers.set(config.name, entry);
    try {
      const client = new Client({ name: "fish-harness", version: "1.0.0" });
      let transport;
      if (config.type === "http" || config.type === "sse") {
        const url = new URL(config.url);
        const opts = { requestInit: { headers: config.headers || {} } };
        transport = config.type === "sse" ? new SSEClientTransport(url, opts) : new StreamableHTTPClientTransport(url, opts);
      } else {
        transport = new StdioClientTransport({
          command: config.command,
          args: config.args || [],
          env: { ...process.env, ...(config.env || {}) },
          stderr: "pipe",
        });
      }
      await withTimeout(client.connect(transport), 30_000, "MCP connect timed out");
      const { tools } = await client.listTools();
      entry.client = client;
      entry.tools = tools;
      entry.status = "connected";
    } catch (err) {
      entry.status = "error";
      entry.error = err.message;
    }
    return entry;
  }

  async disconnect(name) {
    const entry = this.servers.get(name);
    this.servers.delete(name);
    try {
      await entry?.client?.close();
    } catch {}
  }

  async reconnect(name) {
    const entry = this.servers.get(name);
    if (!entry) return null;
    await this.disconnect(name);
    return this.connect(entry.config);
  }

  status() {
    return [...this.servers.values()].map((e) => ({
      ...e.config,
      status: e.status,
      error: e.error,
      tools: (e.tools || []).map((t) => ({ name: t.name, description: t.description })),
    }));
  }

  /** Tool definitions in Anthropic format. */
  toolDefs() {
    const defs = [];
    for (const [name, entry] of this.servers) {
      if (entry.status !== "connected") continue;
      for (const tool of entry.tools) {
        defs.push({
          name: mcpToolName(name, tool.name),
          description: `[MCP · ${name}] ${tool.description || tool.name}`.slice(0, 1024),
          input_schema: tool.inputSchema || { type: "object", properties: {} },
        });
      }
    }
    return defs;
  }

  async call(fullName, input) {
    const [, server, ...rest] = fullName.split("__");
    const toolName = rest.join("__");
    const entry = this.servers.get(server);
    if (!entry?.client) throw new Error(`MCP server "${server}" is not connected`);
    const original = entry.tools.find((t) => sanitize(t.name) === toolName)?.name || toolName;
    const result = await entry.client.callTool({ name: original, arguments: input });
    const parts = (result.content || []).map((c) => {
      if (c.type === "text") return c.text;
      if (c.type === "image") return `[image ${c.mimeType}]`;
      if (c.type === "resource") return c.resource?.text || `[resource ${c.resource?.uri}]`;
      return JSON.stringify(c);
    });
    return { content: parts.join("\n") || "(empty result)", isError: Boolean(result.isError) };
  }

  async closeAll() {
    await Promise.all([...this.servers.keys()].map((n) => this.disconnect(n)));
  }
}

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "_");
export const mcpToolName = (server, tool) => `mcp__${sanitize(server)}__${sanitize(tool)}`.slice(0, 64);

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    }),
  ]);
}

/** Read MCP servers already configured for Claude Desktop / Claude Code / Cursor. */
export function discoverExternalMcp() {
  const home = os.homedir();
  const appData = process.env.APPDATA || path.join(home, "Library", "Application Support");
  const sources = [
    { from: "Claude Desktop", file: path.join(appData, "Claude", "claude_desktop_config.json") },
    { from: "Claude Code", file: path.join(home, ".claude.json") },
    { from: "Cursor", file: path.join(home, ".cursor", "mcp.json") },
  ];
  const found = [];
  for (const src of sources) {
    try {
      const json = JSON.parse(fs.readFileSync(src.file, "utf8"));
      for (const [name, s] of Object.entries(json.mcpServers || {})) {
        found.push({
          from: src.from,
          name,
          type: s.url ? (s.type === "sse" ? "sse" : "http") : "stdio",
          command: s.command,
          args: s.args || [],
          env: s.env || {},
          url: s.url,
          headers: s.headers || {},
          enabled: true,
        });
      }
    } catch {}
  }
  return found;
}
