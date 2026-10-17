import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Plus, X, TerminalSquare, ChevronDown } from "lucide-react";

const THEME = {
  background: "#0f0f0f",
  foreground: "#d4d4d4",
  cursor: "#ededed",
  selectionBackground: "#ffffff30",
  black: "#1e1e1e", red: "#f07178", green: "#9ece6a", yellow: "#e5c07b", blue: "#7aa2f7", magenta: "#c4a7e7", cyan: "#7dcfff", white: "#d4d4d4",
  brightBlack: "#5c5c5c", brightRed: "#ff8b92", brightGreen: "#b9f27c", brightYellow: "#ffd580", brightBlue: "#9ab8ff", brightMagenta: "#d7bcf5", brightCyan: "#a4e0ff", brightWhite: "#ffffff",
};

function TermView({ cwd, visible, onExit }) {
  const host = useRef(null);
  const termRef = useRef(null);
  const fitRef = useRef(null);

  useEffect(() => {
    const term = new Terminal({ fontFamily: "'JetBrains Mono Variable', Consolas, monospace", fontSize: 13, lineHeight: 1.25, cursorBlink: true, theme: THEME, allowProposedApi: true, scrollback: 5000 });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host.current);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {}

    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/api/term?cwd=${encodeURIComponent(cwd)}&cols=${term.cols}&rows=${term.rows}`);
    ws.onmessage = (e) => term.write(typeof e.data === "string" ? e.data : new Uint8Array(e.data));
    ws.onclose = () => onExit?.();
    ws.onerror = () => term.write("\r\n\x1b[31mTerminal connection failed.\x1b[0m\r\n");
    const sub = term.onData((d) => ws.readyState === 1 && ws.send(d));
    const sendSize = () => ws.readyState === 1 && ws.send(`\u0000resize:${term.cols}x${term.rows}`);
    const ro = new ResizeObserver(() => {
      if (!host.current?.offsetParent) return;
      try {
        fit.fit();
        sendSize();
      } catch {}
    });
    ro.observe(host.current);
    ws.onopen = sendSize;
    return () => {
      ro.disconnect();
      sub.dispose();
      ws.onclose = null;
      ws.close();
      term.dispose();
    };
  }, [cwd]);

  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        try {
          fitRef.current?.fit();
        } catch {}
        termRef.current?.focus();
      }, 30);
    }
  }, [visible]);

  return <div ref={host} className="term-host" style={{ display: visible ? "block" : "none" }} />;
}

let seq = 1;

export default function TerminalPanel({ cwd, onHide, shell = "shell", addKey }) {
  const [terms, setTerms] = useState(() => [{ id: seq++ }]);
  const [active, setActive] = useState(terms[0].id);

  const add = () => {
    const t = { id: seq++ };
    setTerms((ts) => [...ts, t]);
    setActive(t.id);
  };
  // Ctrl+Shift+` from the IDE bumps addKey to open another terminal.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) return void (first.current = false);
    add();
  }, [addKey]);

  const close = (id) => {
    setTerms((ts) => {
      const next = ts.filter((t) => t.id !== id);
      if (!next.length) {
        onHide();
        const t = { id: seq++ };
        setActive(t.id);
        return [t];
      }
      if (active === id) setActive(next.at(-1).id);
      return next;
    });
  };

  return (
    <div className="bottom-panel">
      <div className="bottom-head">
        <span className="bottom-title"><TerminalSquare size={13} /> Terminal</span>
        <div className="term-tabs">
          {terms.map((t, i) => (
            <button key={t.id} className={`term-tab ${t.id === active ? "on" : ""}`} onClick={() => setActive(t.id)}>
              {shell} {i + 1}
              <span className="x" onClick={(e) => (e.stopPropagation(), close(t.id))}><X size={11} /></span>
            </button>
          ))}
        </div>
        <span className="grow" />
        <button className="icon-btn sm" title="New terminal (Ctrl+Shift+`)" onClick={add}><Plus size={14} /></button>
        <button className="icon-btn sm" title="Hide panel (Ctrl+`)" onClick={onHide}><ChevronDown size={14} /></button>
      </div>
      <div className="term-body">
        {terms.map((t) => (
          <TermView key={t.id} cwd={cwd} visible={t.id === active} onExit={() => close(t.id)} />
        ))}
      </div>
    </div>
  );
}
