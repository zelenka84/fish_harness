import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import fg from "fast-glob";
import { readSkill } from "./skills.js";

const MAX_OUTPUT = 40_000;
const IGNORE = ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**", "**/.next/**", "**/__pycache__/**", "**/.venv/**"];

export function defaultShell() {
  if (process.platform === "win32") return { label: "PowerShell", cmd: "powershell.exe", args: ["-NoProfile", "-NonInteractive", "-Command"] };
  return { label: "bash", cmd: process.env.SHELL || "/bin/bash", args: ["-lc"] };
}

function resolvePath(ctx, p) {
  if (!p) return ctx.cwd;
  return path.resolve(ctx.cwd, p);
}

export function isInside(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function clip(text, max = MAX_OUTPUT) {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

const shell = defaultShell();

export const BUILTIN_TOOLS = [
  {
    name: "Read",
    kind: "read",
    description: "Read a text file from the workspace. Returns lines prefixed with line numbers. Use offset/limit for large files.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "Path relative to the workspace, or absolute." },
        offset: { type: "integer", description: "1-based line to start from." },
        limit: { type: "integer", description: "Number of lines to read (default 2000)." },
      },
      required: ["file_path"],
    },
    async run({ file_path, offset = 1, limit = 2000 }, ctx) {
      const file = resolvePath(ctx, file_path);
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split(/\r?\n/);
      const start = Math.max(1, offset);
      const slice = lines.slice(start - 1, start - 1 + limit);
      const body = slice.map((l, i) => `${String(start + i).padStart(5)}\t${l}`).join("\n");
      const more = start - 1 + limit < lines.length ? `\n… (${lines.length} lines total)` : "";
      return clip(body + more);
    },
  },
  {
    name: "Write",
    kind: "write",
    description: "Create or overwrite a file with the given content. Parent folders are created automatically.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        content: { type: "string" },
      },
      required: ["file_path", "content"],
    },
    async run({ file_path, content }, ctx) {
      const file = resolvePath(ctx, file_path);
      const before = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      ctx.emit?.({ type: "file_changed", path: file, before, after: content });
      return `${before === null ? "Created" : "Updated"} ${path.relative(ctx.cwd, file) || file} (${content.split("\n").length} lines)`;
    },
  },
  {
    name: "Edit",
    kind: "write",
    description: "Replace an exact string in a file. old_string must match exactly (including whitespace) and be unique unless replace_all is true.",
    input_schema: {
      type: "object",
      properties: {
        file_path: { type: "string" },
        old_string: { type: "string" },
        new_string: { type: "string" },
        replace_all: { type: "boolean" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
    async run({ file_path, old_string, new_string, replace_all }, ctx) {
      const file = resolvePath(ctx, file_path);
      const before = fs.readFileSync(file, "utf8");
      const count = before.split(old_string).length - 1;
      if (count === 0) throw new Error("old_string not found in file");
      if (count > 1 && !replace_all) throw new Error(`old_string matches ${count} times; add context or set replace_all`);
      const after = replace_all ? before.split(old_string).join(new_string) : before.replace(old_string, () => new_string);
      fs.writeFileSync(file, after);
      ctx.emit?.({ type: "file_changed", path: file, before, after });
      return `Edited ${path.relative(ctx.cwd, file)} (${replace_all ? count : 1} replacement${count > 1 && replace_all ? "s" : ""})`;
    },
  },
  {
    name: "Shell",
    kind: "exec",
    description: `Run a command in ${shell.label} from the workspace directory. Returns stdout, stderr and exit code. Default timeout 120s.`,
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "integer", description: "Max runtime in ms (default 120000, max 600000)." },
      },
      required: ["command"],
    },
    run({ command, timeout_ms = 120_000 }, ctx) {
      return new Promise((resolve) => {
        const child = spawn(shell.cmd, [...shell.args, command], { cwd: ctx.cwd, env: process.env, windowsHide: true });
        let out = "";
        const onData = (d) => {
          const s = d.toString();
          out += s;
          ctx.emit?.({ type: "tool_output", text: s });
        };
        child.stdout.on("data", onData);
        child.stderr.on("data", onData);
        const timer = setTimeout(() => child.kill(), Math.min(timeout_ms, 600_000));
        const abort = () => child.kill();
        ctx.signal?.addEventListener("abort", abort);
        child.on("close", (code) => {
          clearTimeout(timer);
          ctx.signal?.removeEventListener("abort", abort);
          resolve(clip(`${out.trim() || "(no output)"}\n[exit code ${code}]`));
        });
        child.on("error", (e) => resolve(`Failed to start shell: ${e.message}`));
      });
    },
  },
  {
    name: "Glob",
    kind: "read",
    description: "Find files by glob pattern (e.g. 'src/**/*.ts'). Ignores node_modules, .git and build output.",
    input_schema: {
      type: "object",
      properties: { pattern: { type: "string" }, path: { type: "string" } },
      required: ["pattern"],
    },
    async run({ pattern, path: p }, ctx) {
      const cwd = resolvePath(ctx, p);
      const files = await fg(pattern, { cwd, ignore: IGNORE, dot: true, onlyFiles: true });
      return files.length ? clip(files.slice(0, 500).join("\n") + (files.length > 500 ? `\n… ${files.length} total` : "")) : "No files matched.";
    },
  },
  {
    name: "Grep",
    kind: "read",
    description: "Search file contents with a JavaScript regular expression. Returns file:line: text matches.",
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string" },
        path: { type: "string" },
        glob: { type: "string", description: "Limit files, e.g. '**/*.js'." },
        case_insensitive: { type: "boolean" },
      },
      required: ["pattern"],
    },
    async run({ pattern, path: p, glob = "**/*", case_insensitive }, ctx) {
      const cwd = resolvePath(ctx, p);
      const re = new RegExp(pattern, case_insensitive ? "i" : "");
      const files = await fg(glob, { cwd, ignore: IGNORE, dot: false, onlyFiles: true });
      const hits = [];
      for (const f of files) {
        if (hits.length >= 300) break;
        let text;
        try {
          const full = path.join(cwd, f);
          if (fs.statSync(full).size > 2_000_000) continue;
          text = fs.readFileSync(full, "utf8");
        } catch {
          continue;
        }
        if (text.includes("\u0000")) continue;
        text.split(/\r?\n/).forEach((line, i) => {
          if (hits.length < 300 && re.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 240)}`);
        });
      }
      return hits.length ? clip(hits.join("\n")) : "No matches.";
    },
  },
  {
    name: "ListDir",
    kind: "read",
    description: "List the entries of a directory (folders end with /).",
    input_schema: { type: "object", properties: { path: { type: "string" } } },
    async run({ path: p }, ctx) {
      const dir = resolvePath(ctx, p);
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries
        .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join("\n") || "(empty)";
    },
  },
  {
    name: "WebFetch",
    kind: "read",
    description: "Fetch a URL and return its readable text content.",
    input_schema: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    async run({ url }, ctx) {
      const res = await fetch(url, { signal: ctx.signal, headers: { "user-agent": "FishHarness/1.0" } });
      const type = res.headers.get("content-type") || "";
      let text = await res.text();
      if (type.includes("html")) {
        text = text
          .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/\s+\n/g, "\n")
          .replace(/[ \t]{2,}/g, " ");
      }
      return clip(`HTTP ${res.status} ${url}\n\n${text.trim()}`, 30_000);
    },
  },
  {
    name: "TodoWrite",
    kind: "meta",
    description: "Replace the visible task list for the current job. Use for multi-step work; keep exactly one item in_progress.",
    input_schema: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              content: { type: "string" },
              status: { type: "string", enum: ["pending", "in_progress", "completed"] },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    async run({ todos }, ctx) {
      ctx.emit?.({ type: "todos", todos });
      return `Task list updated (${todos.filter((t) => t.status === "completed").length}/${todos.length} done).`;
    },
  },
  {
    name: "Skill",
    kind: "meta",
    description: "Load the full instructions of an available skill by name. Call this before doing a task that a listed skill covers.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
    async run({ name }, ctx) {
      const skill = readSkill(ctx.config, name);
      if (!skill || !skill.enabled) throw new Error(`Unknown or disabled skill: ${name}`);
      ctx.emit?.({ type: "skill_loaded", name });
      return `Base directory: ${skill.dir}\n\n${skill.content}`;
    },
  },
];

/** Minimal JSON-schema check: required fields and primitive types. */
export function validateInput(schema, input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "input must be an object";
  for (const key of schema?.required || []) {
    if (!(key in input)) return `missing required field "${key}"`;
  }
  for (const [key, def] of Object.entries(schema?.properties || {})) {
    if (!(key in input) || !def?.type) continue;
    const v = input[key];
    const ok =
      def.type === "string" ? typeof v === "string" :
      def.type === "integer" ? Number.isInteger(v) :
      def.type === "number" ? typeof v === "number" :
      def.type === "boolean" ? typeof v === "boolean" :
      def.type === "array" ? Array.isArray(v) :
      def.type === "object" ? typeof v === "object" && v !== null : true;
    if (!ok) return `field "${key}" must be ${def.type}`;
  }
  return null;
}
