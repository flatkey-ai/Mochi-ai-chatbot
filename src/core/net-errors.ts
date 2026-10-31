/**
 * Tell "we couldn't reach the platform" apart from "the platform said no".
 * A token check that fails because of DNS, TLS, a timeout, a firewall or a proxy must never be
 * reported as a wrong token: the user would keep re-pasting a perfectly good token.
 */

/** Thrown when a platform answered with something that isn't its API (e.g. a proxy or captive-portal page). */
export class UnexpectedResponseError extends Error {
  constructor(readonly status: number) {
    super(`unexpected response (HTTP ${status}, not the platform's API)`);
  }
}

const NETWORK_CODES =
  /^(ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EPIPE|ECONNABORTED|UND_ERR_[A-Z_]+|CERT_[A-Z_]+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_[A-Z_]+|ERR_TLS_[A-Z_]+|ERR_SSL_[A-Z_]+)$/;
const NETWORK_TEXT = /fetch failed|socket hang up|getaddrinfo|certificate|TLS|SSL|timed? ?out|network|proxy|tunnel/i;

/**
 * If `err` is a network-level failure, return a short human description of it
 * (e.g. "ECONNRESET", "timed out after 15s"). Otherwise return null.
 */
export function networkProblem(err: unknown): string | null {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string; errors?: { code?: string }[] } } | null;
  if (!e) return null;
  if (err instanceof UnexpectedResponseError) return err.message;
  if (e.name === "TimeoutError" || e.name === "AbortError") return "timed out after 15s";
  const code = e.cause?.code ?? e.code ?? e.cause?.errors?.[0]?.code;
  if (code && NETWORK_CODES.test(code)) {
    const extra = e.cause?.message && !e.cause.message.includes(code) ? `: ${e.cause.message}` : "";
    return `${code}${extra}`.slice(0, 160);
  }
  const msg = `${e.message ?? ""} ${e.cause?.message ?? ""}`.trim();
  if (err instanceof TypeError && /fetch failed/i.test(msg)) return (e.cause?.message || "fetch failed").slice(0, 160);
  if (NETWORK_TEXT.test(msg)) return msg.slice(0, 160);
  return null;
}

const HOSTS: Record<string, string> = {
  telegram: "api.telegram.org",
  discord: "discord.com",
  slack: "slack.com",
  qq: "bots.qq.com / api.sgroup.qq.com",
};

/** The message shown in the dashboard when a channel check couldn't reach the platform. */
export function unreachableMessage(platform: string, detail: string): string {
  const name = platform === "qq" ? "QQ" : platform[0].toUpperCase() + platform.slice(1);
  return (
    `Couldn't reach ${name} (${HOSTS[platform] ?? platform}) from the computer running Mochi: ${detail}. ` +
    `Your ${platform === "qq" ? "AppID / AppSecret" : "token"} wasn't checked yet, so this is a network problem, not a wrong ${platform === "qq" ? "AppID or AppSecret" : "token"}. ` +
    `If you use a proxy or VPN app (Clash, Surge, V2Ray…), add HTTPS_PROXY=http://127.0.0.1:7890 (your proxy's HTTP port) to .env and restart Mochi.`
  );
}
