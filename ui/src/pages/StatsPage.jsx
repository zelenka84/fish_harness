import { useEffect, useState } from "react";
import { Wallet, Coins, Activity, Database, Timer, Wrench, MessagesSquare, AlertTriangle, Table2 } from "lucide-react";
import { useApp } from "../App.jsx";
import { api, fmt } from "../api.js";
import { modelLabel } from "../models.js";
import { BarChart, LineChart, Legend, HourHeat } from "../components/Charts.jsx";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];

export default function StatsPage() {
  const { state, toast } = useApp();
  const [days, setDays] = useState(30);
  const [scope, setScope] = useState("me");
  const [data, setData] = useState(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    api(`/stats?days=${days}&scope=${scope === "all" ? "all" : "me"}`).then(setData).catch((e) => toast(e.message, "error"));
  }, [days, scope]);

  if (!data) return <div className="page" />;
  const t = data.totals;
  // Color follows the model entity (catalog order), never its rank.
  const modelOrder = [...state.models.map((m) => m.id), ...Object.keys(data.models).filter((id) => !state.models.some((m) => m.id === id))];
  const modelColor = (id) => SERIES[modelOrder.indexOf(id)] || "var(--text-3)";
  const models = Object.entries(data.models).sort((a, b) => b[1].cost - a[1].cost);
  const maxModelCost = Math.max(0.0001, ...models.map(([, m]) => m.cost));
  const tools = Object.entries(data.tools).sort((a, b) => b[1].calls - a[1].calls);
  const maxCalls = Math.max(1, ...tools.map(([, x]) => x.calls));
  const label = (id) => modelLabel(state, state.config, id);
  const empty = t.requests === 0;

  return (
    <div className="page">
      <div className="page-inner">
        <div className="page-head">
          <div>
            <h1>Statistics</h1>
            <p>Spend, tokens and tool activity across your sessions.</p>
          </div>
          <div className="actions">
            {state.accounts.length > 1 && (
              <div className="seg">
                <button className={scope === "me" ? "on" : ""} onClick={() => setScope("me")}>Me</button>
                <button className={scope === "all" ? "on" : ""} onClick={() => setScope("all")}>All accounts</button>
              </div>
            )}
            <div className="seg">
              {[7, 30, 90].map((d) => (
                <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{d}d</button>
              ))}
            </div>
          </div>
        </div>

        {empty && (
          <div className="notice info" style={{ marginBottom: 16 }}>
            <Activity size={16} /> No requests in this period yet — numbers fill in as you work with Fish.
          </div>
        )}

        <div className="grid c4">
          <div className="card kpi hero">
            <span className="label"><Wallet size={14} /> Spend</span>
            <span className="value grad-text">{fmt.cost(t.cost)}</span>
            <span className="sub">{t.requests ? `${fmt.cost(t.cost / Math.max(1, t.sessions))} per session` : "—"}</span>
          </div>
          <div className="card kpi">
            <span className="label"><Coins size={14} /> Tokens</span>
            <span className="value">{fmt.tokens(t.input + t.cacheRead + t.cacheWrite + t.output)}</span>
            <span className="sub">{fmt.tokens(t.input + t.cacheRead + t.cacheWrite)} in · {fmt.tokens(t.output)} out</span>
          </div>
          <div className="card kpi">
            <span className="label"><Database size={14} /> Cache hit rate</span>
            <span className="value">{(t.cacheHitRate * 100).toFixed(0)}%</span>
            <span className="sub">{fmt.tokens(t.cacheRead)} tokens served from cache</span>
          </div>
          <div className="card kpi">
            <span className="label"><MessagesSquare size={14} /> Requests</span>
            <span className="value">{t.requests}</span>
            <span className="sub">{t.sessions} sessions · {t.errors} errors</span>
          </div>
        </div>

        <div className="grid c2" style={{ marginTop: 14, gridTemplateColumns: "2fr 1fr" }}>
          <div className="card chart-card">
            <div className="row">
              <div className="grow">
                <h3>Daily spend</h3>
                <div className="chart-sub">USD per day, last {days} days</div>
              </div>
              <button className="btn xs ghost" onClick={() => setShowTable((s) => !s)}><Table2 size={12} /> {showTable ? "Chart" : "Table"}</button>
            </div>
            {showTable ? (
              <div style={{ maxHeight: 220, overflow: "auto", marginTop: 10 }}>
                <table className="table">
                  <thead><tr><th>Day</th><th>Requests</th><th>Input</th><th>Output</th><th>Cost</th></tr></thead>
                  <tbody>
                    {[...data.days].reverse().map((d) => (
                      <tr key={d.day}><td>{d.day}</td><td>{d.requests}</td><td>{fmt.tokens(d.input)}</td><td>{fmt.tokens(d.output)}</td><td>{fmt.cost(d.cost)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <BarChart data={data.days} value={(d) => d.cost} format={(v) => (v < 1 && v > 0 ? `$${v.toFixed(2)}` : `$${Math.round(v)}`)} label="Daily spend" />
            )}
          </div>
          <div className="col" style={{ gap: 14 }}>
            <div className="card kpi">
              <span className="label"><Timer size={14} /> Avg. response time</span>
              <span className="value">{fmt.ms(t.avgLatencyMs)}</span>
              <span className="sub">per model request</span>
            </div>
            <div className="card kpi">
              <span className="label"><Wrench size={14} /> Tool calls</span>
              <span className="value">{t.toolCalls}</span>
              <span className="sub">{t.requests ? (t.toolCalls / t.requests).toFixed(1) : 0} per request</span>
            </div>
          </div>
        </div>

        <div className="card chart-card" style={{ marginTop: 14 }}>
          <div className="row">
            <div className="grow">
              <h3>Token flow</h3>
              <div className="chart-sub">Tokens per day</div>
            </div>
            <Legend items={[{ name: "Input", color: "var(--series-1)" }, { name: "Output", color: "var(--series-2)" }]} />
          </div>
          <LineChart
            data={data.days}
            label="Tokens per day"
            format={fmt.tokens}
            series={[
              { name: "Input", color: "var(--series-1)", value: (d) => d.input },
              { name: "Output", color: "var(--series-2)", value: (d) => d.output },
            ]}
          />
        </div>

        <div className="grid c2" style={{ marginTop: 14 }}>
          <div className="card chart-card">
            <h3>Spend by model</h3>
            <div className="chart-sub">Share of cost in this period</div>
            <div style={{ marginTop: 12 }}>
              {models.length === 0 && <div className="muted small" style={{ padding: "20px 0" }}>No model usage yet.</div>}
              {models.map(([id, m]) => (
                <div key={id} className="hbar-row" title={`${m.requests} requests · ${fmt.tokens(m.input)} in · ${fmt.tokens(m.output)} out`}>
                  <span className="row ellipsis" style={{ gap: 8 }}><i style={{ width: 9, height: 9, borderRadius: 2, background: modelColor(id), flex: "none" }} />{label(id)}</span>
                  <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(m.cost / maxModelCost) * 100}%`, background: modelColor(id) }} /></div>
                  <span className="mono small" style={{ textAlign: "right" }}>{fmt.cost(m.cost)}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card chart-card">
            <h3>Activity by hour</h3>
            <div className="chart-sub">When you work with Fish (requests, local time)</div>
            <HourHeat hours={data.hours} />
          </div>
        </div>

        <div className="card chart-card" style={{ marginTop: 14 }}>
          <h3>Tools</h3>
          <div className="chart-sub">Calls, speed and failure rate per tool</div>
          {tools.length === 0 ? (
            <div className="muted small" style={{ padding: "20px 0" }}>No tool calls yet.</div>
          ) : (
            <table className="table" style={{ marginTop: 10 }}>
              <thead><tr><th>Tool</th><th style={{ width: "40%" }}>Calls</th><th>Avg time</th><th>Errors</th></tr></thead>
              <tbody>
                {tools.map(([name, x]) => (
                  <tr key={name}>
                    <td className="mono small">{name.startsWith("mcp__") ? name.split("__").slice(1).join(" · ") : name}</td>
                    <td>
                      <div className="row" style={{ gap: 10 }}>
                        <div className="hbar-track grow"><div className="hbar-fill" style={{ width: `${(x.calls / maxCalls) * 100}%`, background: "var(--series-1)" }} /></div>
                        <span style={{ width: 36, textAlign: "right" }}>{x.calls}</span>
                      </div>
                    </td>
                    <td>{fmt.ms(x.ms / x.calls)}</td>
                    <td>{x.errors ? <span className="badge bad"><AlertTriangle size={11} /> {x.errors} · {((x.errors / x.calls) * 100).toFixed(0)}%</span> : <span className="muted">0</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
