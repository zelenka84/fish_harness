const store = {
  get(key, fallback = null) {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      value == null ? localStorage.removeItem(key) : localStorage.setItem(key, value);
    } catch {}
  },
};
export { store };

function headers() {
  return {
    "content-type": "application/json",
    "x-fish-account": store.get("fish.account", "local"),
    "x-fish-token": store.get("fish.token", ""),
  };
}

export async function api(path, { method = "GET", body, signal } = {}) {
  const res = await fetch(`/api${path}`, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined, signal });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

/** POST that streams server-sent events back. */
export async function streamRun(sessionId, content, onEvent, signal) {
  const res = await fetch(`/api/sessions/${sessionId}/run`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ content }),
    signal,
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n\n")) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch {}
        }
      }
    }
  }
}

export const fmt = {
  tokens(n = 0) {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(Math.round(n));
  },
  cost(n = 0) {
    if (n === 0) return "$0.00";
    if (n < 0.01) return "$" + n.toFixed(4);
    return "$" + n.toFixed(2);
  },
  ago(ts) {
    const s = (Date.now() - ts) / 1000;
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
    return new Date(ts).toLocaleDateString();
  },
  ms(n = 0) {
    return n >= 1000 ? (n / 1000).toFixed(1) + "s" : Math.round(n) + "ms";
  },
};

export function basename(p = "") {
  return p.split(/[\\/]/).filter(Boolean).pop() || p;
}
