// Model catalog. Prices are USD per 1M tokens (Anthropic first-party rates).
export const MODELS = [
  {
    id: "fish-tuna-2",
    label: "Fish Tuna 2",
    provider: "anthropic",
    base: "claude-opus-5-5", // runs on this model; the persona below is prepended to the system prompt
    ctx: 1_000_000, input: 4, output: 20, cacheRead: 0.2, tier: "Fish assistant", fallbacks: true,
    persona: `You are Fish Tuna 2, the AI assistant model of Fish Harness, built on Claude Opus 5.5.
Introduce yourself as Fish Tuna 2 when asked who you are; if asked what powers you, say you run on Claude Opus 5.5 by Anthropic.
Personality: calm, sharp and friendly — answer directly, skip filler, and reply in the user's language.`,
  },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", provider: "anthropic", ctx: 1_000_000, input: 4, output: 20, cacheRead: 0.2, tier: "Default", fallbacks: true },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", provider: "anthropic", ctx: 1_000_000, input: 10, output: 50, cacheRead: 0.25, tier: "Most capable", fallbacks: true },
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "anthropic", ctx: 1_000_000, input: 2, output: 10, cacheRead: 0.2, tier: "Fast", fallbacks: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5", provider: "anthropic", ctx: 1_000_000, input: 0.1, output: 0.5, cacheRead: 0.01, tier: "Cheapest", fallbacks: false },
];

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/**
 * Ready-made provider templates. Models are not hard-coded: the UI loads
 * them from the provider's own /models endpoint.
 */
export const PROVIDER_PRESETS = [
  { preset: "openai", name: "OpenAI", type: "openai", baseURL: "https://api.openai.com/v1", keyHint: "sk-…", keyUrl: "https://platform.openai.com/api-keys" },
  { preset: "openrouter", name: "OpenRouter", type: "openai", baseURL: "https://openrouter.ai/api/v1", keyHint: "sk-or-…", keyUrl: "https://openrouter.ai/keys" },
  { preset: "gemini", name: "Google Gemini", type: "openai", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", keyHint: "AIza…", keyUrl: "https://aistudio.google.com/apikey" },
  { preset: "deepseek", name: "DeepSeek", type: "openai", baseURL: "https://api.deepseek.com/v1", keyHint: "sk-…", keyUrl: "https://platform.deepseek.com/api_keys" },
  { preset: "xai", name: "xAI", type: "openai", baseURL: "https://api.x.ai/v1", keyHint: "xai-…", keyUrl: "https://console.x.ai" },
  { preset: "mistral", name: "Mistral", type: "openai", baseURL: "https://api.mistral.ai/v1", keyHint: "", keyUrl: "https://console.mistral.ai/api-keys" },
  { preset: "groq", name: "Groq", type: "openai", baseURL: "https://api.groq.com/openai/v1", keyHint: "gsk_…", keyUrl: "https://console.groq.com/keys" },
  { preset: "together", name: "Together AI", type: "openai", baseURL: "https://api.together.xyz/v1", keyHint: "", keyUrl: "https://api.together.ai/settings/api-keys" },
  { preset: "ollama", name: "Ollama", type: "openai", baseURL: "http://localhost:11434/v1", keyHint: "not needed", local: true },
  { preset: "lmstudio", name: "LM Studio", type: "openai", baseURL: "http://localhost:1234/v1", keyHint: "not needed", local: true },
];

/** Custom-provider models are addressed as "<providerId>::<model>". */
export const SEP = "::";
export const modelKey = (providerId, model) => `${providerId}${SEP}${model}`;

function customModel(p, id) {
  return {
    id: modelKey(p.id, id),
    apiId: id,
    label: id,
    provider: p.id,
    providerName: p.name,
    input: Number(p.modelPricing?.[id]?.input ?? p.pricing?.input) || 0,
    output: Number(p.modelPricing?.[id]?.output ?? p.pricing?.output) || 0,
    cacheRead: 0,
    custom: true,
  };
}

export function findModel(id, config) {
  const builtin = MODELS.find((m) => m.id === id);
  if (builtin) return { ...builtin, apiId: builtin.base || builtin.id, providerName: "Anthropic" };
  const providers = config?.providers || [];
  if (id?.includes(SEP)) {
    const [pid, ...rest] = id.split(SEP);
    const p = providers.find((x) => x.id === pid);
    if (p) return customModel(p, rest.join(SEP));
  }
  // Older configs stored a bare model id: find the provider that lists it.
  for (const p of providers) {
    if (p.id !== "anthropic" && (p.models || []).includes(id)) return customModel(p, id);
  }
  return { id, apiId: id, label: id, provider: "anthropic", providerName: "Anthropic", input: 0, output: 0, cacheRead: 0 };
}

/** Every selectable model, grouped by provider order. */
export function listModels(config) {
  const out = MODELS.map((m) => ({ ...m, apiId: m.base || m.id, providerName: "Anthropic" }));
  for (const p of config?.providers || []) {
    if (p.id === "anthropic") continue;
    for (const m of p.models || []) out.push(customModel(p, m));
  }
  return out;
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
