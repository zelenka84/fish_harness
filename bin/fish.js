#!/usr/bin/env node
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import readline from "node:readline";
import { Harness } from "../core/agent.js";
import { loadConfig, saveConfig, PROMPT_PRESETS } from "../core/config.js";
import { MODELS, EFFORTS, listModels } from "../core/models.js";
import { listSkills, seedSkills } from "../core/skills.js";
import * as store from "../core/store.js";
import { c, gradient, banner, MarkdownStream, summarizeInput, summarizeResult, spinner } from "./term.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => {
  const i = argv.indexOf(name);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, v && !v.startsWith("-") ? 2 : 1);
  return v && !v.startsWith("-") ? v : true;
};

const command = argv[0];

if (command === "serve") {
  argv.shift();
  const port = Number(flag("--port") || 4317);
  const noOpen = flag("--no-open");
  const { startServer } = await import("../server/index.js");
  const srv = await startServer({ port });
  console.log(`\n  ${gradient("🐟 Fish Harness")} ${c.dim("server")}\n  ${c.cyan(srv.url)}\n`);
  if (!noOpen) openUrl(srv.url);
} else if (command === "desktop") {
  const electron = (await import("electron")).default;
  spawn(electron, [path.resolve(here, "..")], { stdio: "inherit", detached: process.platform !== "win32" });
} else if (command === "--help" || command === "-h" || command === "help") {
  printHelp();
} else {
  await repl();
}

function openUrl(url) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  spawn(cmd[0], cmd[1], { stdio: "ignore", detached: true }).unref();
}

function printHelp() {
  console.log(`
${gradient("Fish Harness")} — AI coding agent

${c.bold("Usage")}
  fish                      interactive session in the current folder
  fish -p "prompt"          run one prompt and print the result
  fish serve [--port N]     start the web UI server (opens browser)
  fish desktop              launch the desktop app

${c.bold("Options")}
  --model <id>              model to use (${MODELS.map((m) => m.id).join(", ")})
  --mode <ask|auto-edit|yolo|plan>
  --resume <session-id>     continue a previous session
`);
}

async function repl() {
  const config = loadConfig();
  seedSkills();
  const printMode = flag("-p") ?? flag("--print");
  const modelFlag = flag("--model");
  const modeFlag = flag("--mode");
  const resume = flag("--resume");
  if (modeFlag) saveConfig({ permissionMode: modeFlag });

  const workspace = process.cwd();
  const harness = new Harness();
  await harness.init();

  let session = (resume && store.getSession(resume)) || store.createSession({ workspace, model: modelFlag || config.model });
  session.workspace = workspace;
  if (modelFlag) session.model = modelFlag;

  const oneShot = typeof printMode === "string" ? printMode : argv.length && !argv[0].startsWith("-") ? argv.join(" ") : null;

  let rl;
  const ask = (q) =>
    new Promise((resolve) => {
      if (!rl) return resolve("y");
      rl.question(q, resolve);
    });

  let controller = null;
  const runTurn = async (text) => {
    controller = new AbortController();
    const md = new MarkdownStream((s) => process.stdout.write(s));
    let spin = spinner("Thinking");
    let mode = null; // "text" | "thinking"
    let thinkingShown = false;
    let outAtLineStart = true;
    const stopSpin = () => {
      spin?.stop();
      spin = null;
    };
    await harness.run(session, text, {
      signal: controller.signal,
      approve: async (req) => {
        stopSpin();
        md.flush();
        const answer = (await ask(`\n  ${c.yellow("?")} Allow ${c.bold(req.name)} ${c.dim(summarizeInput(req.name, req.input))}  ${c.dim("[y]es / [a]lways / [n]o")} `)).trim().toLowerCase();
        return answer.startsWith("a") ? "allow_always" : answer.startsWith("n") ? "deny" : "allow";
      },
      emit: (e) => {
        if (e.type === "stream") {
          if (e.block?.type === "thinking") {
            mode = "thinking";
            thinkingShown = false;
          } else if (e.block?.type === "text") {
            stopSpin();
            if (mode === "thinking" && thinkingShown) process.stdout.write("\n");
            process.stdout.write("\n");
            mode = "text";
          }
          if (e.text) {
            if (mode === "thinking") {
              if (!thinkingShown) {
                stopSpin();
                md.flush();
                process.stdout.write(`\n  ${c.dim(c.italic("✻ "))}`);
                thinkingShown = true;
              }
              process.stdout.write(c.dim(c.italic(e.text.replace(/\n/g, "\n    "))));
            } else md.push(e.text);
          }
        } else if (e.type === "assistant_message") {
          md.flush();
          mode = null;
        } else if (e.type === "tool_start") {
          stopSpin();
          md.flush();
          process.stdout.write(`\n  ${c.cyan("●")} ${c.bold(e.name)}${c.dim("(" + summarizeInput(e.name, e.input) + ")")}\n`);
          if (e.name !== "Shell") spin = spinner("Running");
        } else if (e.type === "sub" && e.event.type === "tool_start") {
          stopSpin();
          process.stdout.write(`      ${c.dim("↳ " + e.event.name + "(" + summarizeInput(e.event.name, e.event.input) + ")")}\n`);
          spin = spinner("Subagent working");
        } else if (e.type === "tool_output") {
          stopSpin();
          let out = "";
          for (const ch of e.text.replace(/\r\n/g, "\n")) {
            if (outAtLineStart) out += "    │ ";
            out += ch;
            outAtLineStart = ch === "\n";
          }
          process.stdout.write(c.dim(out));
        } else if (e.type === "tool_done") {
          stopSpin();
          if (!outAtLineStart) process.stdout.write("\n");
          outAtLineStart = true;
          const line = summarizeResult(e.name, e.content);
          process.stdout.write(`    ${c.dim("⎿")} ${e.isError ? c.red(line) : c.dim(line)} ${c.dim(`${e.ms}ms`)}\n`);
        } else if (e.type === "tool_results") {
          spin = spinner("Thinking");
        } else if (e.type === "todos") {
          process.stdout.write(
            "\n" + e.todos.map((t) => `    ${t.status === "completed" ? c.green("✔") : t.status === "in_progress" ? c.cyan("◉") : c.dim("○")} ${t.status === "completed" ? c.dim(c.strike(t.content)) : t.content}`).join("\n") + "\n",
          );
        } else if (e.type === "notice") {
          process.stdout.write(`\n  ${c.yellow("!")} ${e.text}\n`);
        } else if (e.type === "error") {
          stopSpin();
          process.stdout.write(`\n  ${c.red("✖")} ${e.message}\n`);
        } else if (e.type === "done") {
          stopSpin();
          md.flush();
          const u = e.usage;
          process.stdout.write(`\n\n  ${c.dim(`↑ ${fmt(u.input + u.cacheRead)} ↓ ${fmt(u.output)} · $${u.cost.toFixed(4)}`)}\n`);
        }
      },
    });
    controller = null;
  };

  if (oneShot) {
    await runTurn(oneShot);
    await harness.mcp.closeAll();
    process.exit(0);
  }

  console.log(banner({ model: session.model, workspace, mode: loadConfig().permissionMode, skills: listSkills({ ...loadConfig(), workspace }).length }));

  rl = readline.createInterface({ input: process.stdin, output: process.stdout, historySize: 500, terminal: true });
  let lastSigint = 0;
  rl.on("SIGINT", () => {
    if (controller) {
      controller.abort();
      process.stdout.write(`\n  ${c.yellow("■")} interrupted\n`);
      return;
    }
    if (Date.now() - lastSigint < 1500) {
      harness.mcp.closeAll().finally(() => process.exit(0));
      return;
    }
    lastSigint = Date.now();
    process.stdout.write(c.dim("\n  Press Ctrl+C again to exit\n"));
    prompt();
  });

  const prompt = () => {
    const mode = loadConfig().permissionMode;
    const badge = mode === "yolo" ? c.red(" yolo ") : mode === "plan" ? c.magenta(" plan ") : mode === "auto-edit" ? c.yellow(" auto-edit ") : "";
    rl.setPrompt(`\n${badge}${gradient("❯")} `);
    rl.prompt();
  };

  rl.on("line", async (line) => {
    const text = line.trim();
    if (!text) return prompt();
    rl.pause();
    try {
      if (text.startsWith("/")) await slash(text);
      else await runTurn(text);
    } catch (err) {
      console.log(`  ${c.red("✖")} ${err.message}`);
    }
    rl.resume();
    prompt();
  });
  prompt();

  async function slash(text) {
    const [cmd, ...rest] = text.slice(1).split(/\s+/);
    const arg = rest.join(" ");
    const cfg = loadConfig();
    switch (cmd) {
      case "help":
        console.log(
          [
            ["/model [id]", "show or switch model"],
            ["/effort [level]", `reasoning effort (${EFFORTS.join(", ")})`],
            ["/mode [m]", "permissions: ask, auto-edit, yolo, plan"],
            ["/prompt [preset]", `system prompt preset (${PROMPT_PRESETS.map((p) => p.id).join(", ")})`],
            ["/skills", "list skills"],
            ["/mcp", "list MCP servers"],
            ["/stats", "usage statistics (30 days)"],
            ["/cost", "this session's usage"],
            ["/sessions", "recent sessions"],
            ["/resume <id>", "continue a session"],
            ["/compact", "summarize older turns to free context"],
            ["/rewind [n]", "undo the last n prompts (files + conversation)"],
            ["/clear", "start a new session"],
            ["/exit", "quit"],
          ]
            .map(([a, b]) => `  ${c.cyan(a.padEnd(20))}${c.dim(b)}`)
            .join("\n"),
        );
        break;
      case "model":
        if (arg) {
          session.model = arg;
          store.saveSession(session);
        }
        {
          let group = null;
          for (const m of listModels(loadConfig())) {
            if (m.providerName !== group) console.log(`\n  ${c.bold((group = m.providerName))}`);
            console.log(`  ${m.id === session.model ? c.cyan("●") : c.dim("○")} ${m.label.padEnd(28)} ${c.dim(m.id)}`);
          }
          console.log(c.dim("\n  /model <id> to switch. Add providers in the app: Settings → Model providers."));
        }
        break;
      case "effort":
        if (arg) saveConfig({ effort: arg });
        console.log(`  effort: ${c.cyan(loadConfig().effort)}`);
        break;
      case "mode":
        if (arg) saveConfig({ permissionMode: arg });
        console.log(`  permission mode: ${c.cyan(loadConfig().permissionMode)}`);
        break;
      case "prompt":
        if (arg) saveConfig({ promptPreset: arg });
        console.log(c.dim(harness.buildSystemPrompt(workspace)));
        break;
      case "skills":
        for (const s of listSkills({ ...cfg, workspace })) console.log(`  ${s.enabled ? c.green("●") : c.dim("○")} ${c.bold(s.name)} ${c.dim(`[${s.source}]`)}\n    ${c.dim(s.description.slice(0, 110))}`);
        break;
      case "mcp": {
        const st = harness.mcp.status();
        if (!st.length) console.log(c.dim("  No MCP servers. Add them in the desktop/web UI or config.json."));
        for (const s of st) console.log(`  ${s.status === "connected" ? c.green("●") : c.red("●")} ${c.bold(s.name)} ${c.dim(s.status)} ${c.dim(`${s.tools.length} tools`)} ${s.error ? c.red(s.error) : ""}`);
        break;
      }
      case "stats": {
        const st = store.readStats({ days: 30 });
        const t = st.totals;
        console.log(`  ${c.bold("Last 30 days")}\n  requests ${c.cyan(t.requests)} · sessions ${c.cyan(t.sessions)} · tools ${c.cyan(t.toolCalls)}\n  tokens ↑ ${c.cyan(fmt(t.input + t.cacheRead))} ↓ ${c.cyan(fmt(t.output))} · cache hit ${c.cyan((t.cacheHitRate * 100).toFixed(0) + "%")}\n  cost ${c.green("$" + t.cost.toFixed(2))}`);
        const max = Math.max(1, ...st.days.map((d) => d.cost));
        const bars = "▁▂▃▄▅▆▇█";
        console.log("  " + gradient(st.days.map((d) => bars[Math.min(7, Math.floor((d.cost / max) * 7.99))]).join("")));
        break;
      }
      case "compact": {
        const spin = spinner("Compacting");
        try {
          await harness.compact(session);
          spin.stop();
          console.log(`  ${c.green("✔")} Earlier turns summarized ${c.dim(`(${session.compactions} compaction${session.compactions > 1 ? "s" : ""})`)}`);
        } catch (err) {
          spin.stop();
          console.log(`  ${c.red("✖")} ${err.message}`);
        }
        break;
      }
      case "rewind": {
        const { isPromptMessage } = await import("../core/agent.js");
        const n = Math.max(1, Number(arg) || 1);
        const prompts = session.messages.map((m, i) => (isPromptMessage(m) && i >= (session.summaryLength || 0) ? i : -1)).filter((i) => i >= 0);
        const index = prompts[prompts.length - n];
        if (index == null) {
          console.log(c.dim("  Nothing to rewind."));
          break;
        }
        const preview = harness.rewindPreview(session, index);
        if (preview.shell) console.log(`  ${c.yellow("!")} Shell commands ran since then — their effects are not undone.`);
        const r = harness.rewind(session, index, "both");
        console.log(`  ${c.green("↺")} Rewound ${n} prompt${n > 1 ? "s" : ""}; restored ${r.reverted.length} file${r.reverted.length === 1 ? "" : "s"}.`);
        for (const f of r.reverted) console.log(`    ${c.dim(f)}`);
        break;
      }
      case "cost": {
        const u = session.usage;
        console.log(`  ↑ ${fmt(u.input)} in · ${fmt(u.cacheRead)} cached · ↓ ${fmt(u.output)} out · ${c.green("$" + u.cost.toFixed(4))}`);
        break;
      }
      case "sessions":
        for (const s of store.listSessions("local").slice(0, 15)) console.log(`  ${c.dim(s.id)} ${s.title} ${c.dim(new Date(s.updatedAt).toLocaleString())}`);
        break;
      case "resume": {
        const s = store.getSession(arg);
        if (!s) console.log(c.red("  no such session"));
        else {
          session = s;
          session.workspace = workspace;
          console.log(`  resumed ${c.bold(s.title)}`);
        }
        break;
      }
      case "clear":
        session = store.createSession({ workspace, model: session.model });
        console.clear();
        console.log(banner({ model: session.model, workspace, mode: cfg.permissionMode, skills: listSkills({ ...cfg, workspace }).length }));
        break;
      case "exit":
      case "quit":
        await harness.mcp.closeAll();
        process.exit(0);
      default:
        console.log(c.dim(`  Unknown command /${cmd}. Try /help`));
    }
  }
}

function fmt(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(1) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
}
