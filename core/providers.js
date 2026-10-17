import Anthropic from "@anthropic-ai/sdk";

/**
 * Every provider exposes `streamTurn(params)` and resolves to an
 * Anthropic-shaped message: { content, stop_reason, usage, model }.
 * Callbacks: onEvent({ type: "block_start" | "text" | "thinking" | "tool_input", index, ... }).
 */

const clients = new Map();

function anthropicClient(provider) {
  const key = `${provider.apiKey}|${provider.baseURL}`;
  if (!clients.has(key)) {
    const opts = { maxRetries: 3 };
    if (provider.apiKey) opts.apiKey = provider.apiKey;
    if (provider.baseURL) opts.baseURL = provider.baseURL;
    clients.set(key, new Anthropic(opts));
  }
  return clients.get(key);
}

export async function anthropicTurn({ provider, model, modelInfo, system, messages, tools, config, signal, onEvent }) {
  const client = anthropicClient(provider);
  const params = {
    model,
    max_tokens: config.maxTokens || 64000,
    system: [{ type: "text", text: system }],
    messages,
    tools: [
      ...tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, eager_input_streaming: true })),
      ...(config.webSearch && !modelInfo?.custom ? [{ type: "web_search_20260209", name: "web_search" }] : []),
    ],
  };
  // Catalog Claude models get the full feature set; custom models on an
  // Anthropic-compatible endpoint get a plain request they are likely to accept.
  const native = !modelInfo?.custom;
  if (native) {
    params.thinking = { type: "adaptive", display: config.thinkingDisplay || "summarized" };
    params.output_config = { effort: config.effort || "high" };
  }
  if (native && config.promptCaching) params.cache_control = { type: "ephemeral" };

  // Server-side refusal fallback (first-party API only, models that support it).
  const betas = [];
  if (native && config.refusalFallback && modelInfo?.fallbacks && !provider.baseURL) {
    betas.push("server-side-fallback-2026-07-01");
    params.fallbacks = "default";
  }
  // Server-side compaction: older context is summarized into a `compaction` block
  // that we keep in history and send back on every later request.
  if (native && config.compaction) {
    betas.push("compact-2026-01-12");
    params.context_management = { edits: [{ type: "compact_20260112" }] };
  }
  if (betas.length) params.betas = betas;

  const stream = betas.length ? client.beta.messages.stream(params, { signal }) : client.messages.stream(params, { signal });

  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start") {
      onEvent({ type: "block_start", index: event.index, block: event.content_block });
    } else if (event.type === "content_block_delta") {
      const d = event.delta;
      if (d.type === "text_delta") onEvent({ type: "text", index: event.index, text: d.text });
      else if (d.type === "thinking_delta") onEvent({ type: "thinking", index: event.index, text: d.thinking });
      else if (d.type === "input_json_delta") onEvent({ type: "tool_input", index: event.index, partial: d.partial_json });
    } else if (event.type === "content_block_stop") {
      onEvent({ type: "block_stop", index: event.index });
    }
  });

  const message = await stream.finalMessage();
  return message;
}

export function isRetryableParseError(err) {
  return !(err instanceof Anthropic.APIError) && err?.name !== "AbortError" && /JSON/i.test(err?.message || "");
}

export function describeApiError(err) {
  if (/Could not resolve authentication method/i.test(err?.message || "")) {
    return "No API key for this model's provider. Add one in Settings → Model providers, or pick a model from another provider.";
  }
  if (err?.status === 403 || /HTTP 403/.test(err?.message || "")) {
    return `Access denied (403): ${err.message}. The provider may block your region — set a proxy in Settings → Network.`;
  }
  if (err instanceof Anthropic.AuthenticationError) return "Authentication failed — check your API key in Settings → Providers.";
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by the API. Try again in a moment.";
  if (err instanceof Anthropic.NotFoundError) return `Not found: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return "Could not reach the API. Check your network or base URL.";
  if (err instanceof Anthropic.APIError) return `API error ${err.status ?? ""}: ${err.message}`;
  return err?.message || String(err);
}

/* ------------------------- OpenAI-compatible providers ------------------------ */
// For local or third-party models (Ollama, LM Studio, OpenRouter, vLLM…).

function toOpenAiMessages(system, messages) {
  const out = [{ role: "system", content: system }];
  for (const m of messages) {
    if (m.role === "user") {
      if (typeof m.content === "string") {
        out.push({ role: "user", content: m.content });
        continue;
      }
      // Attachments become OpenAI content parts: images as data URLs, text files inline.
      const parts = [];
      for (const b of m.content) {
        if (b.type === "tool_result") {
          const content = typeof b.content === "string" ? b.content : (b.content || []).map((c) => c.text || "").join("\n");
          out.push({ role: "tool", tool_call_id: b.tool_use_id, content });
        } else if (b.type === "text") parts.push({ type: "text", text: b.text });
        else if (b.type === "image" && b.source?.type === "base64") {
          parts.push({ type: "image_url", image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } });
        } else if (b.type === "document" && b.source?.type === "text") {
          parts.push({ type: "text", text: `<file name="${b.title || "attachment"}">\n${b.source.data}\n</file>` });
        } else if (b.type === "document") {
          parts.push({ type: "text", text: `[Attached PDF "${b.title || "document"}" could not be sent: this provider does not accept PDFs.]` });
        }
      }
      if (parts.length) {
        const onlyText = parts.every((p) => p.type === "text");
        out.push({ role: "user", content: onlyText ? parts.map((p) => p.text).join("\n\n") : parts });
      }
    } else if (m.role === "assistant") {
      const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;
      const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("");
      const calls = blocks
        .filter((b) => b.type === "tool_use")
        .map((b) => ({ id: b.id, type: "function", function: { name: b.name, arguments: JSON.stringify(b.input) } }));
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    }
  }
  return out;
}

export async function openAiTurn({ provider, model, system, messages, tools, config, signal, onEvent }) {
  const base = (provider.baseURL || "http://localhost:11434/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      ...providerHeaders(provider),
    },
    body: JSON.stringify({
      model,
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: Math.min(config.maxTokens || 8192, 32000),
      messages: toOpenAiMessages(system, messages),
      tools: tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.input_schema } })),
    }),
  });
  if (!res.ok) throw new Error(`${provider.name}: HTTP ${res.status} ${await res.text()}`);

  let text = "";
  const calls = [];
  let finish = null;
  let usage = {};
  let textStarted = false;
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") continue;
      let json;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      if (json.usage) usage = { input_tokens: json.usage.prompt_tokens || 0, output_tokens: json.usage.completion_tokens || 0 };
      const choice = json.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta || {};
      if (delta.content) {
        if (!textStarted) {
          textStarted = true;
          onEvent({ type: "block_start", index: 0, block: { type: "text", text: "" } });
        }
        text += delta.content;
        onEvent({ type: "text", index: 0, text: delta.content });
      }
      for (const tc of delta.tool_calls || []) {
        const slot = (calls[tc.index] ||= { id: tc.id || `call_${tc.index}_${Date.now()}`, name: "", args: "" });
        if (tc.function?.name) {
          slot.name = tc.function.name;
          onEvent({ type: "block_start", index: 1 + tc.index, block: { type: "tool_use", id: slot.id, name: slot.name, input: {} } });
        }
        if (tc.function?.arguments) {
          slot.args += tc.function.arguments;
          onEvent({ type: "tool_input", index: 1 + tc.index, partial: tc.function.arguments });
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason;
    }
  }

  const content = [];
  if (text) content.push({ type: "text", text });
  for (const c of calls.filter(Boolean)) {
    let input = {};
    try {
      input = c.args ? JSON.parse(c.args) : {};
    } catch {
      input = { __invalid_json: c.args };
    }
    content.push({ type: "tool_use", id: c.id, name: c.name, input });
  }
  const stop_reason = calls.length ? "tool_use" : finish === "length" ? "max_tokens" : "end_turn";
  return { content, stop_reason, usage, model };
}

/* ------------------------------ model discovery ------------------------------ */

/** Extra headers some gateways ask for (OpenRouter shows the app name in its dashboard). */
export function providerHeaders(provider) {
  const h = provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {};
  if (/openrouter\.ai/.test(provider.baseURL || "")) h["x-title"] = "Fish Harness";
  return h;
}

/**
 * Ask a provider which models it serves.
 * Returns { models: string[], pricing: { [id]: { input, output } } } with
 * prices in USD per 1M tokens when the provider publishes them (OpenRouter does).
 */
export async function listProviderModels(provider) {
  if (provider.type === "anthropic") {
    const client = anthropicClient(provider);
    const ids = [];
    for await (const m of client.models.list()) ids.push(m.id);
    return { models: ids.sort(), pricing: {} };
  }
  const base = (provider.baseURL || "").replace(/\/$/, "");
  if (!base) throw new Error("Base URL is required");
  let res;
  try {
    res = await fetch(`${base}/models`, { headers: providerHeaders(provider), signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new Error(`Could not reach ${base} (${err.cause?.code || err.message}). Check the URL, or set a proxy in Settings.`);
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    const hint = res.status === 403 ? " The provider may block your region — set a proxy in Settings → Network." : "";
    throw new Error(`HTTP ${res.status}: ${text}${hint}`);
  }
  const json = await res.json();
  const list = json.data || json.models || [];
  const pricing = {};
  const models = [];
  for (const m of list) {
    const id = (typeof m === "string" ? m : m.id || m.name || "").replace(/^models\//, "");
    if (!id) continue;
    models.push(id);
    const p = m.pricing;
    if (p && (p.prompt != null || p.completion != null)) {
      pricing[id] = { input: Number(p.prompt) * 1e6 || 0, output: Number(p.completion) * 1e6 || 0 };
    }
  }
  return { models: models.sort(), pricing };
}

/* ------------------------------ one-shot calls ------------------------------ */

/**
 * Small non-agentic request (autocomplete, summaries). Returns plain text.
 * Keeps latency low: no tools, low effort, thinking off where the model allows it.
 */
export async function quickText({ provider, modelInfo, system, prompt, maxTokens = 256, signal }) {
  const model = modelInfo.apiId || modelInfo.id;
  if (provider.type === "openai") {
    const base = (provider.baseURL || "").replace(/\/$/, "");
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", ...providerHeaders(provider) },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] }),
    });
    if (!res.ok) throw new Error(`${provider.name}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = await res.json();
    return json.choices?.[0]?.message?.content || "";
  }
  const client = anthropicClient(provider);
  const params = { model, max_tokens: maxTokens, system, messages: [{ role: "user", content: prompt }] };
  if (!modelInfo.custom) {
    params.output_config = { effort: "low" };
    // Haiku 5.5 accepts disabled thinking at effort ≤ high; the Opus/Sonnet 5.5 line rejects it.
    if (/haiku/.test(model)) params.thinking = { type: "disabled" };
  }
  const msg = await client.messages.create(params, { signal });
  return msg.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}
