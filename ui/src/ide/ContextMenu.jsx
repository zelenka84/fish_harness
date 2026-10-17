import { useEffect, useLayoutEffect, useRef, useState } from "react";

export default function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({ left: Math.min(x, window.innerWidth - r.width - 8), top: Math.min(y, window.innerHeight - r.height - 8) });
  }, [x, y]);

  useEffect(() => {
    const close = (e) => !ref.current?.contains(e.target) && onClose();
    const key = (e) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="popover ctx-menu" style={{ position: "fixed", ...pos, minWidth: 210 }} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) =>
        it.sep ? (
          <div key={i} style={{ borderTop: "1px solid var(--border)", margin: "4px 2px" }} />
        ) : (
          <button
            key={i}
            className="menu-item"
            style={it.danger ? { color: "var(--bad)" } : undefined}
            onClick={() => {
              onClose();
              it.run();
            }}
          >
            {it.icon && <it.icon size={14} />}
            <span className="grow">{it.label}</span>
            {it.hint && <span className="sub">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
