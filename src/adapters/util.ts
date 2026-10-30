import { isPrivateHost } from "../core/net-guard.ts";
import type { ImageInput } from "../core/types.ts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * Download an image and inline it as a data: URL. Used for platforms whose file URLs
 * need auth (Telegram embeds the bot token in the URL; Slack needs a bearer token),
 * so those secrets never get sent to a model provider.
 */
export async function fetchAsDataUrl(url: string, headers: Record<string, string> = {}): Promise<ImageInput | null> {
  try {
    // Attachment URLs come from platform payloads, i.e. partly user-controlled. Don't let
    // one aim this server at itself or at a cloud metadata endpoint, even for 20 seconds.
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || isPrivateHost(parsed.hostname)) return null;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const mime = (res.headers.get("content-type") ?? "image/jpeg").split(";")[0];
    if (!mime.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return null;
    return { url: `data:${mime};base64,${buf.toString("base64")}`, mimeType: mime };
  } catch {
    return null;
  }
}

/** Split long replies to fit platform message limits, preferring line breaks. */
export function splitMessage(text: string, max: number): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
