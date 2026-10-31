import crypto from "node:crypto";
import type { Brain } from "../core/brain.ts";
import { ChannelAdapter, type ChannelCapability, type ChatTarget, type HistoryMessage } from "../core/channel.ts";
import type { ImageInput, IncomingMessage } from "../core/types.ts";
import { fetchAsDataUrl, splitMessage } from "./util.ts";

/**
 * LINE adapter (Messaging API, LINE Official Account).
 *
 * Unlike the other channels there is no socket to keep open: LINE pushes events to an HTTPS
 * webhook, so this adapter has no inbound connection of its own. The server exposes
 * POST /webhook/line/:botId, verifies the X-Line-Signature header with the channel secret, and
 * hands the raw body here. That means the deployment needs a public HTTPS URL (or a tunnel) —
 * the only channel in Mochi with that requirement.
 *
 * Reply tokens are single-use and short-lived (~1 minute), so a reply always goes through
 * replyTo() with the token of the message it answers; push is the fallback and the only way to
 * start a conversation.
 */

const API = "https://api.line.me";
const DATA_API = "https://api-data.line.me";
const MAX_TEXT = 4500;

interface LineEvent {
  type: string;
  timestamp?: number;
  replyToken?: string;
  source?: { type: "user" | "group" | "room"; userId?: string; groupId?: string; roomId?: string };
  message?: { id?: string; type?: string; text?: string; fileName?: string; fileSize?: number };
}

export class LineAdapter extends ChannelAdapter {
  readonly platform = "line" as const;
  readonly capabilities: ReadonlySet<ChannelCapability> = new Set<ChannelCapability>(["reply", "send", "media"]);

  private detail = "not started";
  private running = false;
  private botUserId = "";
  private botName = "";
  /** message id → reply token, so replyTo() can answer the message that was actually asked. */
  private readonly replyTokens = new Map<string, { token: string; at: number }>();

  constructor(
    botId: string,
    private readonly channelAccessToken: string,
    private readonly channelSecret: string,
    private readonly brain: Brain,
  ) {
    super(botId);
  }

  /** No socket to open: verify the token and say who we are. */
  async start(): Promise<void> {
    const info = await this.api("GET", `${API}/v2/bot/info`).catch((err) => {
      throw new Error(`LINE rejected this channel access token (${err.message})`);
    });
    this.botUserId = String(info?.userId ?? "");
    this.botName = String(info?.displayName ?? info?.basicId ?? "");
    this.detail = `@${info?.basicId ?? this.botUserId}${this.botName ? ` (${this.botName})` : ""}`;
    this.running = true;
    console.log(`[line:${this.botId}] connected as ${this.detail}`);
  }

  private async api(method: string, url: string, body?: unknown, raw = false): Promise<any> {
    const res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${this.channelAccessToken}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`LINE ${method} ${url.replace(API, "")} ${res.status}: ${text.slice(0, 160)}`);
    }
    if (raw) return Buffer.from(await res.arrayBuffer());
    const text = await res.text();
    return text ? JSON.parse(text) : {};
  }

  /** X-Line-Signature = base64(HMAC-SHA256(channelSecret, rawBody)). Constant-time compare. */
  verifySignature(rawBody: string, signature: string | undefined): boolean {
    if (!signature) return false;
    const expected = crypto.createHmac("sha256", this.channelSecret).update(rawBody, "utf8").digest("base64");
    const a = Buffer.from(expected);
    const b = Buffer.from(String(signature));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /** Called by the HTTP route for every webhook delivery. */
  async handleWebhook(rawBody: string, signature: string | undefined): Promise<void> {
    if (!this.verifySignature(rawBody, signature)) throw new Error("bad LINE signature");
    let payload: { events?: LineEvent[] };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      return;
    }
    for (const event of payload.events ?? []) {
      try {
        await this.onEvent(event);
      } catch (err) {
        console.error(`[line:${this.botId}] event ${event.type} failed: ${(err as Error).message}`);
      }
    }
  }

  private async onEvent(event: LineEvent): Promise<void> {
    const source = event.source;
    if (!source || event.type !== "message" || !event.message) {
      if (event.type !== "message") console.log(`[line:${this.botId}] ignored ${event.type} event`);
      return;
    }
    const roomId = source.groupId ?? source.roomId ?? source.userId ?? "";
    if (!roomId) return;
    const isDirect = source.type === "user";
    const msg = event.message;

    const images: ImageInput[] = [];
    const notes: string[] = [];
    if (msg.type === "image" && msg.id) {
      const img = await fetchAsDataUrl(`${DATA_API}/v2/bot/message/${msg.id}/content`, { authorization: `Bearer ${this.channelAccessToken}` }, { expectMime: "image/jpeg", via: `line:${this.botId}` });
      if (img) images.push(img);
      else notes.push("[sent an image, but it could not be downloaded]");
    } else if (msg.type === "sticker") {
      notes.push("[sent a sticker]");
    } else if (msg.type === "video") {
      notes.push("[sent a video]");
    } else if (msg.type === "audio") {
      notes.push("[sent a voice message]");
    } else if (msg.type === "file") {
      notes.push(`[sent a file${msg.fileName ? ` (${msg.fileName})` : ""}]`);
    } else if (msg.type !== "text") {
      notes.push(`[sent a ${msg.type}]`);
    }

    const ref = msg.id ?? `${event.timestamp ?? Date.now()}`;
    if (event.replyToken) {
      this.replyTokens.set(ref, { token: event.replyToken, at: Date.now() });
      if (this.replyTokens.size > 500) {
        const oldest = this.replyTokens.keys().next().value;
        if (oldest) this.replyTokens.delete(oldest);
      }
    }

    const incoming: IncomingMessage = {
      botId: this.botId,
      platform: "line",
      roomId,
      roomName: isDirect ? undefined : `${source.type} ${roomId.slice(0, 6)}`,
      userId: source.userId ?? roomId,
      userName: source.userId ? `LINE ${source.userId.slice(-4)}` : "LINE user",
      text: [String(msg.text ?? "").trim(), ...notes].filter(Boolean).join("\n"),
      images,
      isDirect,
      mentionsBot: isDirect,
      timestamp: event.timestamp,
      ref,
    };

    const answer = await this.brain.handle(incoming);
    if (answer) await this.replyTo(incoming, answer.text);
  }

  async replyTo(msg: IncomingMessage, text: string): Promise<void> {
    this.require("reply");
    const chunks = splitMessage(text, MAX_TEXT);
    const known = msg.ref ? this.replyTokens.get(msg.ref) : undefined;
    // Reply tokens are single-use and die after ~1 minute: use it for the first chunk only.
    const fresh = known && Date.now() - known.at < 55_000;
    if (fresh) this.replyTokens.delete(msg.ref!);
    const [first, ...rest] = chunks;
    if (fresh) {
      await this.api("POST", `${API}/v2/bot/message/reply`, { replyToken: known!.token, messages: [{ type: "text", text: first }] });
    } else {
      await this.push(msg.isDirect ? { kind: "dm", id: msg.roomId, userId: msg.userId } : { kind: "group", id: msg.roomId }, first);
    }
    for (const chunk of rest) {
      await this.push(msg.isDirect ? { kind: "dm", id: msg.roomId, userId: msg.userId } : { kind: "group", id: msg.roomId }, chunk);
    }
  }

  async sendTo(target: ChatTarget, text: string): Promise<void> {
    this.require("send");
    for (const chunk of splitMessage(text, MAX_TEXT)) await this.push(target, chunk);
  }

  private async push(target: ChatTarget, text: string): Promise<void> {
    const to = target.kind === "dm" ? (target.userId ?? target.id) : target.id;
    await this.api("POST", `${API}/v2/bot/message/push`, { to, messages: [{ type: "text", text }] });
  }

  /** LINE has no history API for bots; say so instead of pretending the room is empty. */
  async fetchHistory(_target: ChatTarget, _limit: number): Promise<HistoryMessage[]> {
    this.require("history");
    return [];
  }

  async stop(): Promise<void> {
    this.running = false;
    this.detail = "stopped";
  }

  status() {
    return { running: this.running, detail: this.detail };
  }
}
