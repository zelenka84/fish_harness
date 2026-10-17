import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBasePrompt } from "./config.js";
import { defaultShell } from "./tools.js";
import { listSkills } from "./skills.js";

const PROJECT_FILES = ["FISH.md", "AGENTS.md", "CLAUDE.md", ".cursorrules"];

/** The layout Fish uses when no custom template is set (Dev-Mode can replace it). */
export const DEFAULT_TEMPLATE = `{{base}}

# Environment
- Workspace: {{workspace}}
- Platform: {{platform}} ({{os_release}})
- Shell tool runs: {{shell}}
- Date: {{date}}

{{skills}}

{{project}}

{{plan_mode}}

{{append}}`;

export const PLAN_MODE_TEXT =
  "# Plan mode\nYou are in plan mode: investigate with read-only tools and present a plan. Do not modify files or run commands that change state.";

export const VARIABLES = [
  { name: "base", desc: "Persona prompt (preset or custom)" },
  { name: "workspace", desc: "Absolute path of the workspace" },
  { name: "platform", desc: "win32, darwin or linux" },
  { name: "os_release", desc: "OS version" },
  { name: "shell", desc: "Shell used by the Shell tool" },
  { name: "date", desc: "Today, YYYY-MM-DD" },
  { name: "permission_mode", desc: "ask, auto-edit, plan or yolo" },
  { name: "skills", desc: "Skills section with header (empty if none)" },
  { name: "skills_list", desc: "Just the '- name: description' lines" },
  { name: "project", desc: "Project instructions section with header" },
  { name: "project_file", desc: "Name of FISH.md / AGENTS.md / CLAUDE.md found" },
  { name: "project_text", desc: "Raw text of that file" },
  { name: "plan_mode", desc: "Plan-mode rules, only when plan mode is on" },
  { name: "append", desc: "\"Always append\" text from the System prompt page" },
  { name: "tools", desc: "Comma-separated enabled tool names" },
];

export function promptVars(config, workspace, toolNames = []) {
  const skills = listSkills({ ...config, workspace }).filter((s) => s.enabled);
  const skillsList = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  let projectFile = "";
  let projectText = "";
  for (const name of PROJECT_FILES) {
    const file = path.join(workspace, name);
    if (fs.existsSync(file)) {
      projectFile = name;
      projectText = fs.readFileSync(file, "utf8").slice(0, 20_000);
      break;
    }
  }
  return {
    base: resolveBasePrompt(config),
    workspace,
    platform: process.platform,
    os_release: os.release(),
    shell: defaultShell().label,
    date: new Date().toISOString().slice(0, 10),
    permission_mode: config.permissionMode,
    skills: skills.length
      ? `# Skills\nSkills are packaged instructions. When a task matches one, call the Skill tool with its name first and follow what it returns.\n${skillsList}`
      : "",
    skills_list: skillsList,
    project: projectFile ? `# Project instructions (${projectFile})\n${projectText}` : "",
    project_file: projectFile,
    project_text: projectText,
    plan_mode: config.permissionMode === "plan" ? PLAN_MODE_TEXT : "",
    append: (config.appendPrompt || "").trim(),
    tools: toolNames.join(", "),
  };
}

/** Replace {{name}} with values; unknown names are left visible so typos show up in the preview. */
export function renderTemplate(template, vars) {
  return template
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, name) => (name in vars ? String(vars[name]) : m))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function activeTemplate(config) {
  const custom = config.promptTemplate;
  return config.devMode && custom?.enabled && custom.text?.trim() ? custom.text : DEFAULT_TEMPLATE;
}
