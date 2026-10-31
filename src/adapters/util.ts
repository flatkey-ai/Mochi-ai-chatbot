import { isPrivateHost } from "../core/net-guard.ts";
import type { ImageInput } from "../core/types.ts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Real image signature, so an HTML login page or JSON error can't pass as a picture. */
export function sniffImageMime(buf: Buffer): string | undefined {
  if (buf.length < 12) return undefined;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 4).toString("latin1") === "GIF8") return "image/gif";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  if (buf[0] === 0x42 && buf[1] === 0x4d) return "image/bmp";
  return undefined;
}

export interface ImageFetchOptions {
  /** What the platform said the file is; used when the CDN answers octet-stream. */
  expectMime?: string;
  /** Label for diagnostics, e.g. "slack". */
  via?: string;
}

/**
 * Download an image and inline it as a data: URL. Used for platforms whose file URLs
 * need auth (Telegram embeds the bot token in the URL; Slack needs a bearer token),
 * so those secrets never get sent to a model provider.
 *
 * Slack and QQ both serve files as application/octet-stream often enough that trusting
 * the HTTP content-type alone silently loses real pictures, so we fall back to the magic
 * bytes and to the platform's own mimetype before giving up.
 */
export async function fetchAsDataUrl(
  url: string,
  headers: Record<string, string> = {},
  opts: ImageFetchOptions = {},
): Promise<ImageInput | null> {
  const label = opts.via ? `[${opts.via}]` : "";
  try {
    // Attachment URLs come from platform payloads, i.e. partly user-controlled. Don't let
    // one aim this server at itself or at a cloud metadata endpoint, even for 20 seconds.
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol) || isPrivateHost(parsed.hostname)) {
      console.log(`${label} image skipped: ${parsed.hostname} is private/reserved`);
      return null;
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) {
      console.log(`${label} image download failed: HTTP ${res.status} from ${parsed.hostname}`);
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const declared = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const sniffed = sniffImageMime(buf);
    const hinted = (opts.expectMime ?? "").toLowerCase();
    const octetLike = declared === "" || declared === "application/octet-stream" || declared === "binary/octet-stream";
    let mime = sniffed ?? (declared.startsWith("image/") ? declared : octetLike && hinted.startsWith("image/") ? hinted : "");
    if (!mime) {
      console.log(`${label} image rejected: content-type=${declared || "none"} hint=${hinted || "none"} bytes=${buf.length}`);
      return null;
    }
    if (buf.length > MAX_IMAGE_BYTES) {
      console.log(`${label} image rejected: ${Math.round(buf.length / 1024)}KB is too large`);
      return null;
    }
    console.log(`${label} image ok: ${mime} ${Math.round(buf.length / 1024)}KB from ${parsed.hostname}`);
    return { url: `data:${mime};base64,${buf.toString("base64")}`, mimeType: mime };
  } catch (err) {
    console.log(`${label} image download error: ${(err as Error).message?.slice(0, 120)}`);
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
