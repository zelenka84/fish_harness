# 🐟 Fish Harness

**An AI coding agent with three interfaces over one engine:** a desktop app (like Claude Desktop → Code), a full IDE (like Cursor) and a terminal CLI (like Claude Code).

Fish reads and edits code, runs commands, searches your project, works with git and MCP servers. It connects to Claude, OpenAI, OpenRouter, Gemini, local models or any compatible API. Everything runs locally: keys, sessions and statistics stay on your machine.

---

## Features

### Agent
- **Tools:** read, write and precise edits, terminal commands (PowerShell / bash), glob and content search, web fetch, task lists, skills.
- **Subagents.** The `Task` tool launches read-only helpers. Several run in parallel, shown as nested cards with their tool calls.
- **Permission modes:**
  - **Ask** — confirm edits and commands.
  - **Auto-edit** — apply edits, still confirm commands.
  - **Plan** — read-only research, ends with a plan.
  - **YOLO** — never ask.
- **Rewind to any prompt.** Restore files, the conversation, or both; the prompt goes back into the composer.
- **Context compaction.** For Claude the API summarizes old turns; for other providers Fish does. Run it by hand with `/compact` — earlier history stays viewable.
- **Self-checks.** After its own edits the agent sees syntax errors in JS, JSON and Python.
- **Attachments:** images, PDFs and code files — paste, drag and drop, or use the paperclip.

### IDE
- **Explorer:** create, rename and delete files, git status colors, context menu.
- **Navigation:** go to file with **Ctrl+P**, search in files with **Ctrl+Shift+F** (regex and include globs).
- **Git panel:** stage and unstage, discard, commit, diff against HEAD.
- **Integrated terminal** (real PTY) with tabs.
- **Editor:** syntax highlighting for every CodeMirror language, breadcrumbs, status bar.
- **Markdown preview:** switch `.md` files between code, split and rendered preview; relative images resolve from the workspace. Images open as a preview too.
- **Tab autocomplete** with ghost text, like Cursor.
- **Diagnostics:** `node --check`, JSON and Python always; TypeScript (5–7), ESLint and ruff when installed in the project. **Fix with Fish** hands the error to the agent.
- **AI in the editor:** **Ctrl+K** edits the selection from a description, **Ctrl+L** sends the selection to the chat.

### Model providers
- **Anthropic.** Claude Opus 5.5 by default, plus Fable 5.1, Sonnet 5.5 and Haiku 5.5, with adaptive thinking, prompt caching, refusal fallback and web search.
- **Presets:** OpenAI, OpenRouter, Google Gemini, DeepSeek, xAI, Mistral, Groq, Together AI, Ollama, LM Studio.
- **Custom providers** with an OpenAI- or Anthropic-compatible API. Models are listed from the provider; prices come from its catalog (OpenRouter) or are entered by hand.
- **Proxy:** the system proxy is picked up automatically; set one manually in Settings → Network.

### Customization
- **System prompt:** personas (Coder, Architect, Reviewer, Mentor), a custom prompt, and "always append" rules. Project instructions are read from `FISH.md`, `AGENTS.md` or `CLAUDE.md`.
- **Dev-Mode** (press **Insert** 10 times in Settings). Write the whole system prompt as a template with variables like `{{workspace}}`, `{{skills}}`, `{{tools}}`, with a live preview. Persona texts are editable too.
- **Skills:** folders with a `SKILL.md`, from `~/.fish-harness/skills`, `<project>/.fish/skills` and Claude Code's skills. Invoke them with `/` in the composer.
- **MCP servers** (stdio / HTTP / SSE), with one-click import from Claude Desktop, Claude Code and Cursor.
- **Accounts:** local profiles with an optional password, each with its own sessions and statistics.
- **Statistics:** spend, tokens, cache hit rate, latency, per-model and per-tool breakdowns, activity by hour.

---

## Install

### Windows installer
Build it (see below) and run `dist\Fish Harness Setup 1.0.0.exe`. On first launch, pick a provider and paste an API key.

### From source
Requires Node.js 20.10+ and git.

```bash
npm install
npm run desktop
```

---

## Run

| Mode | Command |
|---|---|
| Desktop app | `npm run desktop` |
| Web UI in a browser | `npm run serve` |
| Terminal CLI | `node bin/fish.js` (or `npm link`, then `fish`) |
| One-shot prompt | `fish -p "explain this project"` |
| Development with hot reload | `npm run dev` (server :4317, Vite :5173) |
| Build the Windows installer | `npm run dist` |

### CLI commands
`/model`, `/effort`, `/mode`, `/prompt`, `/skills`, `/mcp`, `/stats`, `/cost`, `/compact`, `/rewind [n]`, `/sessions`, `/resume <id>`, `/clear`, `/exit`.

### Keyboard shortcuts
| | |
|---|---|
| `Ctrl+K` | command palette (in the editor: edit with AI) |
| `Ctrl+N` | new session |
| `Ctrl+1…6` | Code, IDE, Skills, Connections, Prompt, Statistics |
| `Ctrl+P` | go to file |
| `Ctrl+Shift+F` / `E` / `G` | search, explorer, git |
| `` Ctrl+` `` | terminal |
| `Ctrl+Shift+V` | toggle Markdown preview |
| `Ctrl+I` / `Ctrl+B` | agent panel, sidebar |
| `Ctrl+L` | selection → chat |
| `Tab` / `Ctrl+→` / `Esc` | accept suggestion, accept one word, dismiss |

---

## Data

Everything lives in `~/.fish-harness` (override with `FISH_HOME`):

```
config.json     settings, providers and keys
sessions/       session history
stats.jsonl     request log for statistics
accounts.json   profiles (passwords stored as scrypt hashes)
skills/         your skills
```

The server listens on `127.0.0.1` only and rejects requests from other origins.

---

## Project layout

```
core/      engine: agent loop, providers, tools, MCP, skills, prompt
           templates, compaction, rewind, diagnostics, autocomplete
server/    local HTTP + SSE API and the IDE back end (files, search, git, terminal)
bin/       the fish CLI
ui/        React UI (Vite)
desktop/   Electron shell
scripts/   helper scripts (icon generation)
```

Stack: Node.js, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, React 19, CodeMirror 6, xterm.js, node-pty, Electron.

---

## License

[Apache License 2.0](LICENSE)
