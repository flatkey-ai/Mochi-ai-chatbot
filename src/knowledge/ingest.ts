import { assertPublicUrl } from "../core/net-guard.ts";

export const SUPPORTED_FILE_TYPES = [".txt", ".md", ".markdown", ".csv", ".json", ".html", ".htm", ".pdf", ".docx"];
const MAX_FILE_BYTES = 15 * 1024 * 1024;
const MAX_URL_BYTES = 3 * 1024 * 1024;
const MAX_REDIRECTS = 3;

/** Extract plain text from an uploaded file. */
export async function extractFileText(filename: string, data: Buffer): Promise<string> {
  if (data.length > MAX_FILE_BYTES) throw new Error("File is too large (max 15 MB).");
  const ext = (filename.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] ?? "").replace(".markdown", ".md");
  switch (ext) {
    case ".txt":
    case ".md":
    case ".csv":
      return data.toString("utf8");
    case ".json":
      return jsonToText(JSON.parse(data.toString("utf8")));
    case ".html":
    case ".htm":
      return htmlToText(data.toString("utf8")).text;
    case ".pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(data));
      const { text } = await extractText(pdf, { mergePages: false });
      return (Array.isArray(text) ? text : [text]).join("\n\n");
    }
    case ".docx": {
      const mammoth = (await import("mammoth")).default;
      const { value } = await mammoth.extractRawText({ buffer: data });
      return value;
    }
    default:
      throw new Error(`Unsupported file type "${ext || filename}". Use ${SUPPORTED_FILE_TYPES.join(", ")}.`);
  }
}

/** Fetch a public web page and extract its readable text. */
export async function fetchUrlText(rawUrl: string): Promise<{ title: string; text: string; url: string }> {
  let url = assertPublicUrl(rawUrl);

  // Redirects are followed by hand: "follow" would let a public URL bounce us to
  // 127.0.0.1 or a metadata endpoint, which is the classic way past this check.
  let res: Response | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    res = await fetch(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
      headers: { "user-agent": "mochi-ai-chatbot/0.2 knowledge-import", accept: "text/html,text/plain,application/pdf;q=0.9,*/*;q=0.5" },
    });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      if (hop === MAX_REDIRECTS) throw new Error("Too many redirects.");
      const next = assertPublicUrl(new URL(location, url), "redirect target");
      await res.body?.cancel().catch(() => {});
      url = next;
      continue;
    }
    break;
  }
  if (!res) throw new Error("The page could not be fetched.");
  if (!res.ok) throw new Error(`The page returned HTTP ${res.status}.`);

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_URL_BYTES) throw new Error("That page is too large to import.");
  const type = res.headers.get("content-type") ?? "";
  if (type.includes("pdf")) return { title: url.pathname.split("/").pop() || url.hostname, text: await extractFileText("x.pdf", buf), url: url.toString() };
  const body = buf.toString("utf8");
  if (type.includes("html") || /^\s*</.test(body)) {
    const { title, text } = htmlToText(body);
    return { title: title || url.hostname + url.pathname, text, url: url.toString() };
  }
  return { title: url.hostname + url.pathname, text: body, url: url.toString() };
}

export function htmlToText(html: string): { title: string; text: string } {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").trim();
  const text = decode(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header|iframe|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(br|hr)\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6]|tr|table|ul|ol|blockquote|pre)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  );
  return { title, text };
}

function decode(s: string): string {
  const named: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“" };
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m);
}

function safeChar(code: number): string {
  try {
    return String.fromCodePoint(code);
  } catch {
    return " ";
  }
}

function jsonToText(v: unknown, prefix = ""): string {
  if (Array.isArray(v)) return v.map((x) => jsonToText(x, prefix)).join("\n\n");
  if (v && typeof v === "object")
    return Object.entries(v)
      .map(([k, x]) => (x && typeof x === "object" ? `${prefix}${k}:\n${jsonToText(x, prefix + "  ")}` : `${prefix}${k}: ${x}`))
      .join("\n");
  return String(v ?? "");
}
