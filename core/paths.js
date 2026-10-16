import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const FISH_HOME = process.env.FISH_HOME || path.join(os.homedir(), ".fish-harness");

export const paths = {
  home: FISH_HOME,
  config: path.join(FISH_HOME, "config.json"),
  accounts: path.join(FISH_HOME, "accounts.json"),
  sessions: path.join(FISH_HOME, "sessions"),
  stats: path.join(FISH_HOME, "stats.jsonl"),
  skills: path.join(FISH_HOME, "skills"),
};

export function ensureDirs() {
  for (const dir of [paths.home, paths.sessions, paths.skills]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

export function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
