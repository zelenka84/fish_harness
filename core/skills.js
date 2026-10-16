import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { paths } from "./paths.js";

/** Parse a tiny YAML frontmatter block (key: value pairs, quoted or not). */
export function parseFrontmatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  let lastKey = null;
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (kv) {
      lastKey = kv[1];
      meta[lastKey] = kv[2].replace(/^["']|["']$/g, "").trim();
    } else if (lastKey && /^\s+\S/.test(line)) {
      meta[lastKey] = `${meta[lastKey]} ${line.trim()}`.trim();
    }
  }
  return { meta, body: text.slice(match[0].length) };
}

function skillRoots(workspace) {
  const roots = [
    { dir: paths.skills, source: "fish", editable: true },
    { dir: path.join(os.homedir(), ".claude", "skills"), source: "claude", editable: false },
  ];
  if (workspace) {
    roots.push({ dir: path.join(workspace, ".fish", "skills"), source: "project", editable: true });
    roots.push({ dir: path.join(workspace, ".claude", "skills"), source: "project", editable: false });
  }
  return roots;
}

export function listSkills(config) {
  const seen = new Map();
  for (const root of skillRoots(config.workspace)) {
    let entries = [];
    try {
      entries = fs.readdirSync(root.dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const file = path.join(root.dir, entry.name, "SKILL.md");
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      const { meta, body } = parseFrontmatter(text);
      const name = meta.name || entry.name;
      if (seen.has(name)) continue;
      seen.set(name, {
        name,
        description: meta.description || body.split("\n").find((l) => l.trim()) || "",
        source: root.source,
        editable: root.editable,
        dir: path.join(root.dir, entry.name),
        file,
        enabled: !config.disabledSkills.includes(name),
        size: text.length,
      });
    }
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function readSkill(config, name) {
  const skill = listSkills(config).find((s) => s.name === name);
  if (!skill) return null;
  const content = fs.readFileSync(skill.file, "utf8");
  return { ...skill, content };
}

export function slugify(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/^-+|-+$/g, "") || "skill";
}

export function saveSkill({ name, description, body, content }) {
  const slug = slugify(name);
  const dir = path.join(paths.skills, slug);
  fs.mkdirSync(dir, { recursive: true });
  const text =
    content ??
    `---\nname: ${slug}\ndescription: ${String(description || "").replace(/\n/g, " ")}\n---\n\n${body || ""}\n`;
  fs.writeFileSync(path.join(dir, "SKILL.md"), text);
  return slug;
}

export function deleteSkill(config, name) {
  const skill = listSkills(config).find((s) => s.name === name);
  if (!skill || !skill.editable) throw new Error("Skill is not editable");
  fs.rmSync(skill.dir, { recursive: true, force: true });
}

/** Ships a few starter skills on first run so the Skills page is never empty. */
export function seedSkills() {
  if (fs.readdirSync(paths.skills).length) return;
  saveSkill({
    name: "commit-message",
    description: "Write a conventional, informative git commit message for the staged changes.",
    body: `# Commit message\n\n1. Run \`git diff --staged\` (fall back to \`git diff\`).\n2. Summarise the change in an imperative subject line under 72 chars, using a conventional prefix (feat, fix, refactor, docs, test, chore).\n3. Add a short body explaining *why*, wrapped at 72 columns.\n4. Show the message to the user; commit only if they ask.`,
  });
  saveSkill({
    name: "code-review",
    description: "Review the current diff for bugs, ranked by severity with file:line references.",
    body: `# Code review\n\n- Read the diff (\`git diff\`, or the files the user names).\n- For each issue give: severity (high/medium/low), file:line, what breaks and a concrete input that triggers it.\n- Skip style nits unless asked. End with an overall verdict.`,
  });
  saveSkill({
    name: "write-tests",
    description: "Add focused unit tests for a module using the project's existing test framework.",
    body: `# Write tests\n\n1. Detect the test framework from package/config files and existing tests.\n2. Cover the happy path, edge cases and one failure mode per public function.\n3. Run the tests and fix failures caused by the new tests.\n4. Report coverage gaps you did not address.`,
  });
}
