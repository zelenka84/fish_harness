# 🐟 Fish Harness

AI coding harness with three faces over one engine:

| Mode | How to run |
|---|---|
| **Desktop app** (like Claude Desktop → Code) | `npm run desktop` |
| **IDE mode** (like Cursor: explorer + editor + agent) | inside the app, `Ctrl+2` |
| **Terminal CLI** (like Claude Code) | `node bin/fish.js` or `npm link` → `fish` |
| Web UI in a browser | `fish serve` |

## Features
- **API**: Anthropic (Claude Opus 5.5 by default, streaming, adaptive thinking, prompt caching, refusal fallback, web search) + any OpenAI-compatible provider (Ollama, LM Studio, OpenRouter…).
- **MCP**: stdio / HTTP / SSE servers, one-click import from Claude Desktop, Claude Code and Cursor.
- **System prompt**: personas (Coder, Architect, Reviewer, Mentor), custom prompt, "always append" rules, full preview. Picks up `FISH.md` / `AGENTS.md` / `CLAUDE.md` from the project.
- **Skills**: `SKILL.md` folders from `~/.fish-harness/skills`, `<project>/.fish/skills` and `~/.claude/skills`; type `/` in the composer.
- **Permissions**: Ask · Auto-edit · Plan (read-only) · YOLO, with inline approval cards.
- **Accounts**: local profiles with optional password; sessions and stats are per account.
- **Statistics**: spend, tokens, cache hit rate, latency, per-model and per-tool breakdowns.

## Setup
```bash
npm install
npm run build
npm run desktop
```
Paste your Anthropic API key on first launch (or set `ANTHROPIC_API_KEY`). Data lives in `~/.fish-harness` (override with `FISH_HOME`).

Development with hot reload: `npm run dev` (server on :4317, Vite on :5173). Windows installer: `npm run dist`.

## Layout
```
core/     agent loop, providers, tools, MCP, skills, storage
server/   local HTTP + SSE API (127.0.0.1 only)
bin/      CLI (fish)
ui/       React UI (Vite)
desktop/  Electron shell
```
