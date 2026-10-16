import { paths, readJson, writeJson, ensureDirs } from "./paths.js";

export const PROMPT_PRESETS = [
  {
    id: "fish-coder",
    name: "Fish Coder",
    description: "Balanced autonomous coding agent (default).",
    text: `You are Fish, an expert software engineering agent running inside Fish Harness.
You work directly in the user's workspace using tools: read and search code before changing it, make focused edits, and verify your work by running commands when that is useful.

Guidelines:
- Match the style, naming and idioms of the surrounding code.
- Prefer small, correct changes over sweeping rewrites.
- Keep the user informed with short progress notes; finish with a brief summary of what changed and what is left.
- For multi-step work, keep a task list with the TodoWrite tool.
- Never invent file contents, command output or test results — check with tools.`,
  },
  {
    id: "architect",
    name: "Architect",
    description: "Plans and explains before touching code.",
    text: `You are Fish in Architect mode. Investigate the codebase thoroughly, then present a clear, numbered implementation plan with trade-offs and risks. Do not modify files unless the user explicitly approves the plan.`,
  },
  {
    id: "reviewer",
    name: "Code Reviewer",
    description: "Finds bugs, ranks them by severity.",
    text: `You are Fish in Review mode. Review the requested code for correctness bugs, security issues and maintainability problems. Report findings ranked by severity with file:line references and a concrete failure scenario for each. Do not edit files.`,
  },
  {
    id: "teacher",
    name: "Mentor",
    description: "Explains concepts step by step.",
    text: `You are Fish in Mentor mode. Explain code and concepts clearly and patiently, with small examples. When the user asks for changes, make them and explain why each change works.`,
  },
];

const DEFAULTS = {
  version: 1,
  theme: "dark",
  accent: "aqua",
  model: "claude-opus-5-5",
  effort: "high",
  maxTokens: 64000,
  thinkingDisplay: "summarized",
  refusalFallback: true,
  promptCaching: true,
  webSearch: false,
  permissionMode: "ask", // ask | auto-edit | yolo | plan
  workspace: process.cwd(),
  promptPreset: "fish-coder",
  customPrompt: "",
  appendPrompt: "",
  providers: [
    { id: "anthropic", type: "anthropic", name: "Anthropic", apiKey: "", baseURL: "" },
  ],
  mcpServers: [],
  disabledSkills: [],
  disabledTools: [],
};

let cache = null;

export function loadConfig() {
  ensureDirs();
  if (!cache) {
    const saved = readJson(paths.config, {});
    cache = { ...DEFAULTS, ...saved };
    if (!cache.providers?.some((p) => p.id === "anthropic")) {
      cache.providers = [DEFAULTS.providers[0], ...(cache.providers || [])];
    }
  }
  return cache;
}

export function saveConfig(patch) {
  const next = { ...loadConfig(), ...patch };
  cache = next;
  writeJson(paths.config, next);
  return next;
}

export function getProvider(config, id) {
  return config.providers.find((p) => p.id === id);
}

/** Config safe to send to the UI: API keys are masked. */
export function publicConfig(config = loadConfig()) {
  return {
    ...config,
    providers: config.providers.map((p) => ({
      ...p,
      apiKey: p.apiKey ? `${p.apiKey.slice(0, 7)}…${p.apiKey.slice(-4)}` : "",
      hasKey: Boolean(p.apiKey) || (p.type === "anthropic" && Boolean(process.env.ANTHROPIC_API_KEY)),
    })),
  };
}

/** Merge a config patch coming from the UI, ignoring masked keys. */
export function applyPublicPatch(patch) {
  const current = loadConfig();
  if (patch.providers) {
    patch.providers = patch.providers.map((p) => {
      const old = current.providers.find((o) => o.id === p.id);
      const masked = typeof p.apiKey === "string" && p.apiKey.includes("…");
      const { hasKey, ...rest } = p;
      return { ...rest, apiKey: masked ? old?.apiKey || "" : p.apiKey || "" };
    });
  }
  return saveConfig(patch);
}

export function resolveBasePrompt(config) {
  if (config.promptPreset === "custom") return config.customPrompt || PROMPT_PRESETS[0].text;
  return (PROMPT_PRESETS.find((p) => p.id === config.promptPreset) || PROMPT_PRESETS[0]).text;
}
