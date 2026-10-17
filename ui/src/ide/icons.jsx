import { FileCode2, FileJson, FileText, FileImage, FileCog, FileTerminal, File, Lock } from "lucide-react";

const BY_EXT = {
  js: ["#e5c07b", FileCode2], jsx: ["#61afef", FileCode2], mjs: ["#e5c07b", FileCode2], cjs: ["#e5c07b", FileCode2],
  ts: ["#4f9cf0", FileCode2], tsx: ["#4f9cf0", FileCode2], py: ["#6fa8dc", FileCode2], rs: ["#d38c5a", FileCode2],
  go: ["#5dc9e2", FileCode2], java: ["#e06c75", FileCode2], kt: ["#a97bff", FileCode2], c: ["#8fa3c4", FileCode2],
  cpp: ["#8fa3c4", FileCode2], h: ["#8fa3c4", FileCode2], cs: ["#7bc87b", FileCode2], php: ["#9a8fd8", FileCode2],
  rb: ["#e06c75", FileCode2], swift: ["#f08d49", FileCode2], lua: ["#7d9be0", FileCode2], luau: ["#7d9be0", FileCode2],
  html: ["#e4875f", FileCode2], css: ["#61afef", FileCode2], scss: ["#d685b0", FileCode2], vue: ["#6cc497", FileCode2],
  svelte: ["#f07b54", FileCode2], json: ["#e5c07b", FileJson], md: ["#a0a0a0", FileText], txt: ["#a0a0a0", FileText],
  yml: ["#c09a6b", FileCog], yaml: ["#c09a6b", FileCog], toml: ["#c09a6b", FileCog], env: ["#c09a6b", FileCog],
  sh: ["#8cc265", FileTerminal], ps1: ["#5a9bd5", FileTerminal], bat: ["#8cc265", FileTerminal], sql: ["#d4a356", FileCode2],
  png: ["#b48ead", FileImage], jpg: ["#b48ead", FileImage], jpeg: ["#b48ead", FileImage], gif: ["#b48ead", FileImage],
  svg: ["#e5c07b", FileImage], webp: ["#b48ead", FileImage], ico: ["#b48ead", FileImage], lock: ["#7a7a7a", Lock],
};

export function FileIcon({ name = "", size = 15 }) {
  const lower = name.toLowerCase();
  const ext = lower.startsWith(".env") ? "env" : lower.split(".").pop();
  const [color, Icon] = BY_EXT[ext] || ["var(--text-3)", File];
  return <Icon size={size} style={{ color, flex: "none" }} />;
}
