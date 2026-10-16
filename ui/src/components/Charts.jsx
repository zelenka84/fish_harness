import { useEffect, useRef, useState } from "react";

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const shortDay = (d) => {
  const [, m, day] = d.split("-");
  return `${Number(day)}.${m}`;
};

/** Single-series vertical bars with 4px rounded tops and hover tooltip. */
export function BarChart({ data, value, format, height = 200, color = "var(--series-1)", label }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 44, r: 8, t: 10, b: 24 };
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(...data.map(value), 0));
  const step = iw / Math.max(1, data.length);
  const bw = Math.max(2, step - 2); // 2px gap between bars
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 46)));

  return (
    <div className="chart" ref={ref}>
      <svg height={height} role="img" aria-label={label}>
        <g className="axis">
          {ticks.map((t) => {
            const y = pad.t + ih - (t / max) * ih;
            return (
              <g key={t}>
                <line className={t === 0 ? "baseline" : "grid-line"} x1={pad.l} x2={pad.l + iw} y1={y} y2={y} />
                <text x={pad.l - 8} y={y + 3.5} textAnchor="end">{format(t)}</text>
              </g>
            );
          })}
          {data.map((d, i) =>
            i % labelEvery === 0 ? (
              <text key={d.day} x={pad.l + i * step + step / 2} y={height - 6} textAnchor="middle">{shortDay(d.day)}</text>
            ) : null,
          )}
        </g>
        {data.map((d, i) => {
          const v = value(d);
          const h = v > 0 ? Math.max(2, (v / max) * ih) : 0;
          const x = pad.l + i * step + 1;
          const y = pad.t + ih - h;
          const r = Math.min(4, bw / 2, h);
          return (
            <g key={d.day} onMouseEnter={() => setHover({ i, x: x + bw / 2, y })} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * step} y={pad.t} width={step} height={ih} fill="transparent" />
              {h > 0 && (
                <path
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + bw - r} Q${x + bw},${y} ${x + bw},${y + r} V${y + h} Z`}
                  fill={color}
                  opacity={hover && hover.i !== i ? 0.45 : 1}
                  style={{ transition: "opacity .15s" }}
                />
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: hover.x, top: hover.y + pad.t }}>
          <div className="tt">{new Date(data[hover.i].day).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</div>
          <div className="tv"><i style={{ width: 9, height: 9, borderRadius: 2, background: color, display: "inline-block" }} /> {format(value(data[hover.i]))}</div>
        </div>
      )}
    </div>
  );
}

/** Multi-series line chart, one axis, crosshair tooltip, direct end labels. */
export function LineChart({ data, series, format, height = 220, label }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 48, r: 70, t: 12, b: 24 };
  const iw = Math.max(10, width - pad.l - pad.r);
  const ih = height - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...data.flatMap((d) => series.map((s) => s.value(d)))));
  const x = (i) => pad.l + (data.length <= 1 ? iw / 2 : (i / (data.length - 1)) * iw);
  const y = (v) => pad.t + ih - (v / max) * ih;
  const labelEvery = Math.ceil(data.length / Math.max(1, Math.floor(iw / 46)));

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - pad.l;
    const i = Math.round((px / iw) * (data.length - 1));
    if (i >= 0 && i < data.length) setHover(i);
  };

  return (
    <div className="chart" ref={ref}>
      <svg height={height} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <g className="axis">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line className={f === 0 ? "baseline" : "grid-line"} x1={pad.l} x2={pad.l + iw} y1={y(f * max)} y2={y(f * max)} />
              <text x={pad.l - 8} y={y(f * max) + 3.5} textAnchor="end">{format(f * max)}</text>
            </g>
          ))}
          {data.map((d, i) => (i % labelEvery === 0 ? <text key={d.day} x={x(i)} y={height - 6} textAnchor="middle">{shortDay(d.day)}</text> : null))}
        </g>
        {series.map((s) => {
          const pts = data.map((d, i) => `${x(i)},${y(s.value(d))}`).join(" L");
          const last = data.at(-1);
          return (
            <g key={s.name}>
              <path d={`M${pts} L${x(data.length - 1)},${y(0)} L${x(0)},${y(0)} Z`} fill={s.color} opacity="0.08" />
              <path d={`M${pts}`} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {last && (
                <text x={x(data.length - 1) + 8} y={y(s.value(last)) + 4} fontSize="11" fill="var(--text-2)">{s.name}</text>
              )}
            </g>
          );
        })}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--border-3)" strokeDasharray="3 3" />
            {series.map((s) => (
              <circle key={s.name} cx={x(hover)} cy={y(s.value(data[hover]))} r="4.5" fill={s.color} stroke="var(--surface)" strokeWidth="2" />
            ))}
          </g>
        )}
      </svg>
      {hover != null && (
        <div className="chart-tip" style={{ left: x(hover), top: pad.t + 10 }}>
          <div className="tt">{new Date(data[hover].day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</div>
          {series.map((s) => (
            <div key={s.name} className="tv"><i style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: "inline-block" }} /> {s.name}: {format(s.value(data[hover]))}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <div className="legend">
      {items.map((it) => (
        <span key={it.name}><i style={{ background: it.color }} />{it.name}</span>
      ))}
    </div>
  );
}

/** Sequential single-hue ramp (blue) for magnitude. */
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
export function HourHeat({ hours }) {
  const max = Math.max(1, ...hours);
  const [hover, setHover] = useState(null);
  return (
    <div className="chart" style={{ marginTop: 10 }}>
      <div className="heat">
        {hours.map((v, h) => (
          <div
            key={h}
            onMouseEnter={() => setHover(h)}
            onMouseLeave={() => setHover(null)}
            style={{ background: v ? RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * (RAMP.length - 1) + 0.5))] : "var(--surface-3)", outline: hover === h ? "2px solid var(--text)" : "none" }}
          />
        ))}
      </div>
      <div className="row small muted" style={{ justifyContent: "space-between", marginTop: 6, fontSize: 11 }}>
        <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
      </div>
      {hover != null && (
        <div className="small" style={{ marginTop: 4 }}>
          <b>{String(hover).padStart(2, "0")}:00</b> <span className="muted">— {hours[hover]} requests</span>
        </div>
      )}
    </div>
  );
}
