import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { X, CheckCircle2, AlertCircle } from "lucide-react";

export function FishLogo({ size = 24, id = "fl" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f5f5f5" />
          <stop offset="1" stopColor="#a3a3a3" />
        </linearGradient>
      </defs>
      <path d="M16 32 C23 18 43 15 55 32 C43 49 23 46 16 32 Z" fill={`url(#${id})`} />
      <path d="M18 32 L6 21 Q10.5 32 6 43 Z" fill={`url(#${id})`} />
      <circle cx="45" cy="29.5" r="2.7" fill="#0f0f0f" />
      <path d="M36 22.5 Q31 32 36 41.5" stroke="#0f0f0f" strokeOpacity=".35" strokeWidth="2.2" fill="none" strokeLinecap="round" />
      <path d="M26 27 Q30 24 34 26" stroke="#fff" strokeOpacity=".35" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function Switch({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className={`switch ${on ? "on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Modal({ title, icon, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          {icon}
          <h2 className="grow">{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** Anchored dropdown that closes on outside click / Escape. */
export function Popover({ anchor, open, onClose, children, placement = "top", align = "left", style }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchor?.current?.contains(e.target)) return;
      onClose();
    };
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchor]);
  if (!open) return null;
  const pos = placement === "top" ? { bottom: "calc(100% + 8px)" } : { top: "calc(100% + 8px)" };
  const side = align === "left" ? { left: 0 } : { right: 0 };
  return (
    <div ref={ref} className="popover" style={{ ...pos, ...side, ...style }}>
      {children}
    </div>
  );
}

export function useDropdown() {
  const anchor = useRef(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return { anchor, open, setOpen, close, toggle: () => setOpen((o) => !o) };
}

/* ---------------------------------- Toasts ---------------------------------- */
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  // A toast pushed with the same `key` replaces the previous one instead of stacking.
  const push = useCallback((text, kind = "success", key) => {
    const id = Math.random();
    setToasts((t) => [...t.filter((x) => !key || x.key !== key), { id, key, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === "error" ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Avatar({ account, size = 30 }) {
  const initials = (account?.name || "?")
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.4, background: account?.color || "#94a3b8" }}>
      {initials}
    </span>
  );
}
