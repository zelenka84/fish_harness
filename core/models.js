// Model catalog. Prices are USD per 1M tokens (Anthropic first-party rates).
export const MODELS = [
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", ctx: 1_000_000, input: 4, output: 20, cacheRead: 0.2, tier: "Default", fallbacks: true },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", provider: "anthropic", ctx: 1_000_000, input: 10, output: 50, cacheRead: 0.25, tier: "Most capable", fallbacks: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", ctx: 1_000_000, input: 2, output: 10, cacheRead: 0.2, tier: "Fast", fallbacks: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", ctx: 1_000_000, input: 0.1, output: 0.5, cacheRead: 0.01, tier: "Cheapest", fallbacks: false },
];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export function findModel(id, config) {
  const builtin = MODELS.find((m) => m.id === id);
  if (builtin) return builtin;
  for (const p of config?.providers || []) {
    if (p.type !== "openai") continue;
    if ((p.models || []).includes(id)) {
      return { id, label: id, provider: p.id, input: 0, output: 0, cacheRead: 0, custom: true };
    }
  }
  return { id, label: id, provider: "anthropic", input: 0, output: 0, cacheRead: 0 };
}

export function costOf(model, usage) {
  if (!model || !usage) return 0;
  const inTok = usage.input_tokens || 0;
  const outTok = usage.output_tokens || 0;
  const cacheRead = usage.cache_read_input_tokens || 0;
  const cacheWrite = usage.cache_creation_input_tokens || 0;
  return (
    (inTok * model.input + outTok * model.output + cacheRead * model.cacheRead + cacheWrite * model.input * 1.25) /
    1_000_000
  );
}
