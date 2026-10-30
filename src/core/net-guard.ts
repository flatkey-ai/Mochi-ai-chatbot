import { isIP } from "node:net";

/**
 * Outbound URL policy for anything a chat user or the dashboard can steer:
 * knowledge import, image attachments. Mochi runs next to its own dashboard
 * (which holds every secret) and, on most hosts, next to a cloud metadata
 * endpoint — so private, loopback, link-local and reserved ranges are refused.
 */

const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local + cloud metadata (169.254.169.254)
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // documentation
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking — where fake-ip DNS pools live
  ["198.51.100.0", 24], // documentation
  ["203.0.113.0", 24], // documentation
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved
];

const toInt = (ip: string): number => ip.split(".").reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);

function v4Blocked(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const value = toInt(ip);
  return BLOCKED_V4.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (~((1 << (32 - bits)) - 1) >>> 0);
    return (value & mask) === (toInt(net) & mask);
  });
}

function v6Blocked(ip: string): boolean {
  const h = ip.toLowerCase();
  const mapped = h.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return v4Blocked(mapped[1]);
  if (h === "::" || h === "::1") return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // unique local fc00::/7
  if (/^fe[89ab]/.test(h)) return true; // link-local fe80::/10
  if (h.startsWith("::ffff:")) return true; // any other v4-mapped form
  return false;
}

/** True when a hostname or IP literal points somewhere only this machine can reach. */
export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal")) return true;
  if (h.endsWith(".test") || h.endsWith(".invalid") || h.endsWith(".example")) return true;
  const v = isIP(h);
  if (v === 4) return v4Blocked(h);
  if (v === 6) return v6Blocked(h);
  return false;
}

/** Throws unless the URL is a plain http(s) URL to a public host. */
export function assertPublicUrl(rawUrl: string | URL, what = "URL"): URL {
  let url: URL;
  try {
    url = rawUrl instanceof URL ? new URL(rawUrl.toString()) : new URL(rawUrl);
  } catch {
    throw new Error(`That isn't a valid ${what}.`);
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error(`Only http(s) ${what}s are supported.`);
  if (url.username || url.password) throw new Error(`${what} must not contain credentials.`);
  if (isPrivateHost(url.hostname)) throw new Error("Private, loopback or reserved addresses are refused.");
  return url;
}
