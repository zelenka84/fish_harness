// Terminal styling helpers for the Fish CLI (no dependencies).
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (open, close) => (s) => (tty ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));

export const c = {
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  under: wrap(4, 24),
  strike: wrap(9, 29),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  rgb: (r, g, b) => (s) => (tty ? `\x1b[38;2;${r};${g};${b}m${s}\x1b[39m` : String(s)),
  bg: (r, g, b) => (s) => (tty ? `\x1b[48;2;${r};${g};${b}m${s}\x1b[49m` : String(s)),
};

// Aqua → violet, the Fish Harness accent.
const FROM = [45, 212, 191];
const TO = [129, 140, 248];
export function gradient(text) {
  if (!tty) return text;
  const chars = [...text];
  return chars
    .map((ch, i) => {
      const t = chars.length > 1 ? i / (chars.length - 1) : 0;
      const [r, g, b] = FROM.map((f, k) => Math.round(f + (TO[k] - f) * t));
      return `\x1b[38;2;${r};${g};${b}m${ch}`;
    })
    .join("") + "\x1b[39m";
}

export function banner({ model, workspace, mode, skills }) {
  const art = [
    "      ▄▄▄▄▄▄          ",
    "   ▄█▀ ●    ▀█▄   ▄█  ",
    "  ██   ‿      ▀███▀   ",
    "   ▀█▄      ▄█▀  ▀█   ",
    "      ▀▀▀▀▀▀          ",
  ];
  const info = [
    c.bold(gradient("Fish Harness")) + c.dim("  v1.0"),
    `${c.dim("model")}      ${model}`,
    `${c.dim("workspace")}  ${workspace}`,
    `${c.dim("mode")}       ${mode}  ${c.dim("·")}  ${skills} skills`,
    c.dim("/help for commands · Ctrl+C to interrupt"),
  ];
  return "\n" + art.map((l, i) => `  ${gradient(l)}  ${info[i] || ""}`).join("\n") + "\n";
}

/** Line-buffered markdown renderer for streamed text. */
export class MarkdownStream {
  constructor(write) {
    this.write = write;
    this.buf = "";
    this.inCode = false;
  }
  push(text) {
    this.buf += text;
    let nl;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      this.renderLine(this.buf.slice(0, nl));
      this.write("\n");
      this.buf = this.buf.slice(nl + 1);
    }
  }
  flush() {
    if (this.buf) {
      this.renderLine(this.buf);
      this.buf = "";
    }
  }
  renderLine(line) {
    if (/^\s*```/.test(line)) {
      this.inCode = !this.inCode;
      const lang = line.replace(/`/g, "").trim();
      this.write(c.dim(this.inCode ? `  ╭─ ${lang || "code"}` : "  ╰─"));
      return;
    }
    if (this.inCode) {
      this.write(`  ${c.dim("│")} ${c.rgb(165, 243, 252)(line)}`);
      return;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      this.write("  " + c.bold(h[1].length <= 2 ? gradient(h[2]) : h[2]));
      return;
    }
    let out = line
      .replace(/^(\s*)[-*]\s+/, (_, s) => `${s}${c.cyan("•")} `)
      .replace(/^(\s*)(\d+)\.\s+/, (_, s, n) => `${s}${c.cyan(n + ".")} `)
      .replace(/\*\*(.+?)\*\*/g, (_, t) => c.bold(t))
      .replace(/`([^`]+)`/g, (_, t) => c.rgb(125, 211, 252)(t))
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `${c.under(t)} ${c.dim(u)}`);
    if (/^>\s?/.test(line)) out = c.dim("│ ") + c.italic(out.replace(/^>\s?/, ""));
    this.write("  " + out);
  }
}

export function summarizeInput(name, input = {}) {
  const v = input.file_path || input.command || input.pattern || input.url || input.path || input.name;
  if (v) return String(v).replace(/\s+/g, " ").slice(0, 80);
  if (name === "TodoWrite") return `${input.todos?.length || 0} items`;
  const s = JSON.stringify(input);
  return s.length > 80 ? s.slice(0, 77) + "…" : s;
}

export function summarizeResult(name, content = "") {
  const text = String(content);
  const lines = text.split("\n").length;
  if (name === "Read") return `${lines} lines`;
  if (name === "Glob" || name === "Grep") return text.startsWith("No ") ? text : `${lines} results`;
  const first = text.split("\n").find((l) => l.trim()) || "";
  return first.length > 100 ? first.slice(0, 97) + "…" : first;
}

export function spinner(label) {
  if (!tty) return { stop() {} };
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const started = Date.now();
  const timer = setInterval(() => {
    const secs = ((Date.now() - started) / 1000).toFixed(0);
    process.stdout.write(`\r  ${gradient(frames[i++ % frames.length])} ${c.dim(`${label}… ${secs}s`)}  `);
  }, 90);
  return {
    stop() {
      clearInterval(timer);
      process.stdout.write("\r\x1b[2K");
    },
  };
}
