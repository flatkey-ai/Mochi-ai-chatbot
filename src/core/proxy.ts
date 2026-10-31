import { EnvHttpProxyAgent, fetch as undiciFetch, setGlobalDispatcher } from "undici";
import { HttpsProxyAgent } from "https-proxy-agent";

/**
 * Optional outbound proxy. Node ignores the operating system's proxy settings, so on a machine
 * that reaches the internet through Clash, Surge, a corporate proxy and so on, Telegram or
 * Flatkey can be unreachable from Mochi even though they open fine in the browser.
 *
 * Set HTTPS_PROXY (or HTTP_PROXY / ALL_PROXY) to an http:// proxy URL and Mochi sends its
 * HTTP traffic through it: Flatkey, Telegram (polling + replies), QQ / Discord / Slack REST calls,
 * channel token checks, image downloads and knowledge-base imports. NO_PROXY is respected;
 * localhost is always direct.
 */

let configured: string | null = null;

export function proxyUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy || "";
  const url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    console.warn(`[mochi] ignoring proxy "${url}": only http:// or https:// proxy URLs are supported (use your proxy app's HTTP port).`);
    return null;
  }
  return url;
}

/** Route Node's fetch through the proxy from the environment, if one is set. Call once at startup. */
export function configureProxy(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = proxyUrl(env);
  if (!url) return null;
  const noProxy = [env.NO_PROXY || env.no_proxy, "localhost", "127.0.0.1", "::1"].filter(Boolean).join(",");
  const agent = new EnvHttpProxyAgent({ httpProxy: url, httpsProxy: url, noProxy });
  setGlobalDispatcher(agent);
  // Use undici's own fetch with its dispatcher so the agent and fetch always come from the same library.
  globalThis.fetch = ((input: any, init?: any) => undiciFetch(input, { ...init, dispatcher: agent })) as unknown as typeof fetch;
  configured = url;
  return url;
}

/** Agent for libraries built on node-fetch / https (grammy). Undefined when no proxy is configured. */
export function proxyAgent(): HttpsProxyAgent<string> | undefined {
  const url = configured ?? proxyUrl();
  return url ? new HttpsProxyAgent(url) : undefined;
}

/** For logs: the proxy without any credentials in it. */
export function redactedProxy(url: string): string {
  try {
    const u = new URL(url);
    if (u.username || u.password) u.username = u.password = "***";
    return u.toString().replace(/\/$/, "");
  } catch {
    return "(invalid proxy URL)";
  }
}
