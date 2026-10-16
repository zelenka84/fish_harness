import { useState } from "react";
import { KeyRound, ArrowRight } from "lucide-react";
import { useApp } from "../App.jsx";

/** Slim banner shown until a provider has credentials. */
export default function Onboarding() {
  const { config, updateConfig, toast } = useApp();
  const [key, setKey] = useState("");
  const save = async () => {
    if (!key.trim()) return;
    const providers = config.providers.map((p) => (p.id === "anthropic" ? { ...p, apiKey: key.trim() } : p));
    await updateConfig({ providers });
    toast("API key saved — you're ready to go");
  };
  return (
    <div style={{ padding: "12px 20px 0" }}>
      <div className="card row" style={{ padding: "12px 14px", gap: 12, borderColor: "rgba(45,212,191,.3)", background: "linear-gradient(90deg, rgba(45,212,191,.1), rgba(129,140,248,.06) 60%, transparent), var(--glass)" }}>
        <div className="skill-glyph"><KeyRound size={17} /></div>
        <div className="grow" style={{ minWidth: 160 }}>
          <b>Connect an API key</b>
          <div className="small muted">Paste your Anthropic key to start. It's stored locally in your Fish config.</div>
        </div>
        <input className="input mono" type="password" style={{ maxWidth: 300 }} placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
        <button className="btn primary" onClick={save}>Connect <ArrowRight size={15} /></button>
      </div>
    </div>
  );
}
