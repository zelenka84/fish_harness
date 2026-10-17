import { useState } from "react";
import { Server, ArrowRight } from "lucide-react";
import { ProviderModal } from "./Providers.jsx";

/** Slim banner shown until some provider is ready to use. */
export default function Onboarding() {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ padding: "12px 20px 0" }}>
      <div className="card row" style={{ padding: "12px 14px", gap: 12 }}>
        <div className="skill-glyph"><Server size={17} /></div>
        <div className="grow" style={{ minWidth: 160 }}>
          <b>Connect a model provider</b>
          <div className="small muted">Anthropic, OpenAI, OpenRouter, Gemini, DeepSeek, Ollama — or your own endpoint. Keys stay on this machine.</div>
        </div>
        <button className="btn primary" onClick={() => setOpen(true)}>Choose provider <ArrowRight size={15} /></button>
      </div>
      {open && <ProviderModal initial={null} onClose={() => setOpen(false)} />}
    </div>
  );
}
