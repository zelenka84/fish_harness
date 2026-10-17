// Mirrors core/models.js: custom-provider models are keyed "<providerId>::<model>".
export const SEP = "::";
export const modelKey = (providerId, model) => `${providerId}${SEP}${model}`;

export function providerReady(p) {
  return Boolean(p.hasKey || (p.type === "openai" && p.baseURL && p.local) || (p.type === "openai" && p.baseURL && /localhost|127\.0\.0\.1/.test(p.baseURL)));
}

/** Selectable models grouped by provider. */
export function modelGroups(state, config) {
  const groups = [];
  const anthropic = config.providers.find((p) => p.id === "anthropic");
  const others = config.providers.filter((p) => p.id !== "anthropic");
  if (anthropic?.hasKey || !others.some((p) => (p.models || []).length)) {
    groups.push({
      id: "anthropic",
      name: "Anthropic",
      ready: Boolean(anthropic?.hasKey),
      models: state.models.map((m) => ({ id: m.id, label: m.label, sub: `${m.tier} · $${m.input}/$${m.output} per MTok` })),
    });
  }
  for (const p of others) {
    if (!(p.models || []).length) continue;
    groups.push({
      id: p.id,
      name: p.name,
      ready: true,
      models: p.models.map((m) => ({ id: modelKey(p.id, m), label: m, sub: p.name })),
    });
  }
  return groups;
}

export function modelLabel(state, config, id) {
  if (!id) return "";
  const builtin = state.models.find((m) => m.id === id);
  if (builtin) return builtin.label;
  if (id.includes(SEP)) {
    const [pid, ...rest] = id.split(SEP);
    const p = config.providers.find((x) => x.id === pid);
    return rest.join(SEP) + (p ? ` · ${p.name}` : "");
  }
  return id;
}
