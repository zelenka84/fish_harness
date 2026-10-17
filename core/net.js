import { setGlobalDispatcher, Agent, ProxyAgent, EnvHttpProxyAgent } from "undici";

let applied = null;

/**
 * Route every outgoing fetch (model APIs, MCP over HTTP, WebFetch) through
 * the configured proxy, or HTTP(S)_PROXY from the environment. Node's fetch
 * ignores those variables on its own.
 */
export function applyProxy(config) {
  const explicit = (config?.proxy || "").trim();
  const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || "";
  const key = explicit || (env ? `env:${env}` : "direct");
  if (key === applied) return describeProxy(config);
  if (explicit) setGlobalDispatcher(new ProxyAgent(explicit));
  else if (env) setGlobalDispatcher(new EnvHttpProxyAgent());
  else setGlobalDispatcher(new Agent());
  applied = key;
  return describeProxy(config);
}

export function describeProxy(config) {
  const explicit = (config?.proxy || "").trim();
  if (explicit) return { mode: "manual", url: explicit };
  const env = process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || "";
  return env ? { mode: "system", url: env } : { mode: "direct", url: "" };
}
