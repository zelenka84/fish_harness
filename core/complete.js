import { loadConfig, getProvider } from "./config.js";
import { findModel } from "./models.js";
import { quickText } from "./providers.js";

const SYSTEM = `You are an inline code completion engine inside an IDE.
Return ONLY the exact text to insert at <CURSOR> — no explanations, no markdown fences, no repetition of the text before or after the cursor.
Complete the current statement or a few lines at most. If nothing useful fits, return an empty string.`;

/** Pick the model for completions: the configured one, else a fast Claude model, else the default model. */
export function completionModel(config = loadConfig()) {
  if (config.completionModel) return config.completionModel;
  const anthropic = getProvider(config, "anthropic");
  if (anthropic?.apiKey || process.env.ANTHROPIC_API_KEY) return "claude-haiku-5-5";
  return config.model;
}

export async function completeCode({ path, prefix, suffix, signal }) {
  const config = loadConfig();
  const modelInfo = findModel(completionModel(config), config);
  const provider = getProvider(config, modelInfo.provider) || getProvider(config, "anthropic");
  const prompt = `File: ${path}\n\n${prefix.slice(-4000)}<CURSOR>${suffix.slice(0, 1500)}`;
  let text = await quickText({ provider, modelInfo, system: SYSTEM, prompt, maxTokens: 200, signal });
  text = text.replace(/^```[\w-]*\n?/, "").replace(/\n?```\s*$/, "");
  // Models sometimes echo the line they were given; drop an echoed prefix.
  const lastLine = prefix.split("\n").pop();
  if (lastLine.trim() && text.startsWith(lastLine)) text = text.slice(lastLine.length);
  return { text, model: modelInfo.id };
}

