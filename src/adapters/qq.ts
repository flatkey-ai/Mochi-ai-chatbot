import type { Brain } from "../core/brain.ts";
import { ChannelAdapter, type ChannelCapability, type ChatTarget } from "../core/channel.ts";
import type { ImageInput, IncomingMessage } from "../core/types.ts";
import { fetchAsDataUrl, splitMessage } from "./util.ts";

/**
 * QQ adapter, using the official QQ Bot Open Platform (q.qq.com) API v2 over the
 * WebSocket gateway, so no public URL is needed.
 *
 * Handles:
 *  - QQ groups:   GROUP_AT_MESSAGE_CREATE (@bot), GROUP_MESSAGE_CREATE (if the group grants "all messages")
 *  - Private:     C2C_MESSAGE_CREATE
 *  - QQ guilds:   AT_MESSAGE_CREATE (@bot in a channel), DIRECT_MESSAGE_CREATE
 *
 * Platform rules this respects: replies are passive (they quote the incoming msg_id, valid for
 * 5 minutes, with msg_seq increasing per extra chunk), and URLs in replies are blocked unless the
 * domain is registered, so links are rewritten as plain text.
 */

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const API_BASE = "https://api.sgroup.qq.com";

const INTENT_GUILDS = 1 << 0;
const INTENT_DIRECT_MESSAGE = 1 << 12;
const INTENT_GROUP_AND_C2C = 1 << 25;
const INTENT_PUBLIC_GUILD_MESSAGES = 1 << 30;
const ALL_INTENTS = INTENT_GUILDS | INTENT_DIRECT_MESSAGE | INTENT_GROUP_AND_C2C | INTENT_PUBLIC_GUILD_MESSAGES;

export interface QQEndpoints {
  tokenUrl?: string;
  apiBase?: string;
}

/** Exchange AppID + AppSecret for an access token. Throws on bad credentials. */
export async function qqAccessToken(appId: string, appSecret: string, http: typeof fetch = fetch, tokenUrl = TOKEN_URL) {
  const res = await http(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ appId, clientSecret: appSecret }),
    signal: AbortSignal.timeout(15_000),
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(body.message || `HTTP ${res.status}`);
  return { token: String(body.access_token), expiresAt: Date.now() + Number(body.expires_in ?? 7200) * 1000 };
}

export class QQAdapter extends ChannelAdapter {
  readonly platform = "qq" as const;
  /**
   * QQ is the most limited channel: passive replies only (msg_id, 5 minute window), no
   * history API. Active sends exist but are quota-limited by the platform.
   */
  readonly capabilities: ReadonlySet<ChannelCapability> = new Set<ChannelCapability>(["reply", "send", "media"]);
  private ws: WebSocket | null = null;
  private token = "";
  private tokenExpiresAt = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private seq: number | null = null;
  private sessionId = "";
  private intents = ALL_INTENTS;
  private stopped = false;
  private ready = false;
  private detail = "not started";
  private reconnects = 0;
  private botName = "";
  private readonly tokenUrl: string;
  private readonly apiBase: string;
  /** Who to answer in each room. The inbound message id rides on the message itself (msg.ref). */
  private readonly peerByRoom = new Map<string, { kind: "group" | "dm"; peer: string }>();

  constructor(
    botId: string,
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly brain: Brain,
    endpoints: QQEndpoints = {},
  ) {
    super(botId);
    this.tokenUrl = endpoints.tokenUrl ?? TOKEN_URL;
    this.apiBase = endpoints.apiBase ?? API_BASE;
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.ensureToken();
    const me = await this.api("GET", "/users/@me").catch(() => null);
    this.botName = me?.username ?? "";
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.ready = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    try {
      this.ws?.close(1000);
    } catch {
      /* ignore */
    }
    this.ws = null;
    this.detail = "stopped";
  }

  status() {
    return { running: this.ready, detail: this.detail };
  }

  // ── auth + REST ──

  private async ensureToken(): Promise<string> {
    if (this.token && Date.now() < this.tokenExpiresAt - 60_000) return this.token;
    const t = await qqAccessToken(this.appId, this.appSecret, fetch, this.tokenUrl);
    this.token = t.token;
    this.tokenExpiresAt = t.expiresAt;
    return this.token;
  }

  private async api(method: string, path: string, body?: unknown): Promise<any> {
    const token = await this.ensureToken();
    const res = await fetch(this.apiBase + path, {
      method,
      headers: { authorization: `QQBot ${token}`, "content-type": "application/json", "x-union-appid": this.appId },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(`QQ ${method} ${path} ${res.status}: ${data.message ?? text.slice(0, 200)}`);
    return data;
  }

  // ── gateway ──

  private async connect(): Promise<void> {
    const { url } = await this.api("GET", "/gateway");
    if (!url) throw new Error("QQ gateway returned no URL");
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        err ? reject(err) : resolve();
      };
      ws.onmessage = (ev) => {
        let p: any;
        try {
          p = JSON.parse(String(ev.data));
        } catch {
          return;
        }
        void this.onPayload(p, settle);
      };
      ws.onclose = (ev) => this.onClose(ev.code, settle);
      ws.onerror = () => settle(new Error("QQ gateway connection failed"));
    });
  }

  private async onPayload(p: any, settle: (err?: Error) => void): Promise<void> {
    if (typeof p.s === "number") this.seq = p.s;
    switch (p.op) {
      case 10: {
        // Hello → identify or resume, then heartbeat.
        const token = `QQBot ${await this.ensureToken()}`;
        if (this.sessionId && this.seq !== null) {
          this.send({ op: 6, d: { token, session_id: this.sessionId, seq: this.seq } });
        } else {
          this.send({ op: 2, d: { token, intents: this.intents, shard: [0, 1], properties: { $os: process.platform, $browser: "mochi", $device: "mochi" } } });
        }
        const every = Number(p.d?.heartbeat_interval ?? 41250);
        if (this.heartbeat) clearInterval(this.heartbeat);
        this.heartbeat = setInterval(() => this.send({ op: 1, d: this.seq }), every);
        return;
      }
      case 0:
        if (p.t === "READY" || p.t === "RESUMED") {
          if (p.t === "READY") this.sessionId = p.d?.session_id ?? "";
          this.ready = true;
          this.reconnects = 0;
          const name = p.d?.user?.username || this.botName;
          if (name) this.botName = name;
          this.detail = `${this.botName ? this.botName + " · " : ""}${this.intents === INTENT_GROUP_AND_C2C ? "groups + private chats" : "groups, private chats, guilds"}`;
          console.log(`[qq:${this.botId}] connected${this.botName ? ` as ${this.botName}` : ""}`);
          settle();
          return;
        }
        // One line per dispatch: without this, an event QQ sends but we don't handle is
        // invisible and the bot just looks silent.
        console.log(`[qq:${this.botId}] event ${p.t}${p.d?.id ? ` msg=${p.d.id}` : ""}${p.d?.group_openid ? ` group=${String(p.d.group_openid).slice(-6)}` : ""}`);
        void this.onEvent(p.t, p.d).catch((e) => console.error(`[qq:${this.botId}]`, e?.message ?? e));
        return;
      case 7: // server asks us to reconnect
        this.ws?.close(4000);
        return;
      case 9: // invalid session: start fresh
        this.sessionId = "";
        this.seq = null;
        this.ws?.close(4000);
        return;
      default:
        return;
    }
  }

  private onClose(code: number, settle: (err?: Error) => void): void {
    this.ready = false;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    if (this.stopped) return;
    console.log(`[qq:${this.botId}] gateway closed (code ${code}), reconnects=${this.reconnects}`);
    // 4014: an intent isn't enabled for this bot (e.g. guild features). Retry with groups + private chats only.
    if (code === 4014 && this.intents !== INTENT_GROUP_AND_C2C) {
      this.intents = INTENT_GROUP_AND_C2C;
      this.sessionId = "";
      this.seq = null;
    } else if ([4004, 4010, 4011, 4012, 4013, 4914, 4915].includes(code)) {
      this.detail = `QQ closed the connection (code ${code}). Check the bot's permissions on q.qq.com.`;
      settle(new Error(this.detail));
      return;
    } else if ([4006, 4007, 4009].includes(code)) {
      this.sessionId = "";
      this.seq = null;
    }
    if (++this.reconnects > 20) {
      this.detail = "Disconnected after too many retries";
      settle(new Error(this.detail));
      return;
    }
    const wait = Math.min(30_000, 1000 * 2 ** Math.min(this.reconnects, 5));
    this.detail = `reconnecting (code ${code})…`;
    setTimeout(() => {
      if (!this.stopped) this.connect().then(() => settle(), (e) => settle(e));
    }, wait);
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(payload));
  }

  // ── events → brain → passive reply ──

  private async onEvent(type: string, d: any): Promise<void> {
    if (!d || d.author?.bot) return;

    const ctx = this.resolveContext(type, d);
    if (!ctx) {
      // Event types we do not act on (GROUP_ADD_ROBOT, ...) or new ones QQ added. Log them
      // so "the bot ignored me" is diagnosable instead of silent.
      console.log(`[qq:${this.botId}] unhandled event ${type}`);
      return;
    }
    const { roomId, userId, userName, isDirect, mentionsBot, roomName, kind, peer, inboundId } = ctx;
    if (!userId) {
      console.log(`[qq:${this.botId}] dropped ${type}: no user id in payload (keys=${Object.keys(d ?? {}).join(",")})`);
      return;
    }

    const images: ImageInput[] = [];
    const notes: string[] = [];
    const attachments: any[] = Array.isArray(d.attachments) ? d.attachments : [];
    let logged = 0;
    for (const a of attachments) {
      const attachmentKind = classifyAttachment(a);
      const url = attachmentUrl(a);
      if (attachmentKind === "image" && url) {
        // QQ's rich-media CDN answers 400 to clients that don't look like a browser.
        const img = await fetchAsDataUrl(
          url,
          {
            "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
            accept: "image/*,*/*;q=0.8",
          },
          { expectMime: String(a?.content_type ?? ""), via: `qq:${this.botId}` },
        );
        if (img) images.push(img);
        else notes.push("[sent an image, but it could not be downloaded]");
        if (logged++ < 3) console.log(`[qq:${this.botId}] media: image via ${safeHost(url)} -> ${img ? "ok" : "download failed"}`);
      } else if (attachmentKind === "image") {
        notes.push("[sent an image, but no URL came with it]");
      } else if (attachmentKind === "video") {
        // Vision models take images; say a video arrived instead of pretending nothing did.
        notes.push(`[sent a video${fileHint(a)}]`);
        if (logged++ < 3) console.log(`[qq:${this.botId}] media: video ${a?.content_type ?? "?"} (not downloaded)`);
      } else if (attachmentKind === "audio") {
        notes.push("[sent a voice message]");
        if (logged++ < 3) console.log(`[qq:${this.botId}] media: audio ${a?.content_type ?? "?"} (not downloaded)`);
      } else if (attachmentKind === "file") {
        notes.push(`[sent a file${fileHint(a)}]`);
        if (logged++ < 3) console.log(`[qq:${this.botId}] media: file ${a?.content_type ?? "?"} (not downloaded)`);
      } else if (logged++ < 3) {
        console.log(`[qq:${this.botId}] media: skipped attachment ${JSON.stringify(a).slice(0, 160)}`);
      }
    }

    // If media came in but nothing usable came out, print the raw shape once: that is the
    // fastest way to see whether QQ changed a field name or the CDN refused the download.
    if (attachments.length && !images.length) {
      const sample = JSON.stringify(attachments[0] ?? {});
      console.log(
        `[qq:${this.botId}] media: ${attachments.length} attachment(s), no image usable — keys=[${Object.keys(attachments[0] ?? {}).join(",")}] ` +
          `sample=${sample.replace(/rkey=[^&"]+/gi, "rkey=<redacted>").slice(0, 260)}`,
      );
    }

    const text = [stripQQMarkup(String(d.content ?? "")), ...notes].filter(Boolean).join("\n").trim();
    const incoming: IncomingMessage = {
      botId: this.botId,
      platform: "qq",
      roomId,
      roomName,
      userId,
      userName,
      text,
      images,
      isDirect,
      mentionsBot,
      timestamp: d.timestamp ? Date.parse(d.timestamp) || undefined : undefined,
      ref: inboundId,
    };
    // Where to answer this room; the msg_id travels on the message so two overlapping
    // events cannot steal each other's reply.
    this.peerByRoom.set(roomId, { kind, peer });

    const answer = await this.brain.handle(incoming);
    if (answer) await this.replyTo(incoming, answer.text);
  }

  /**
   * Normalize a QQ event into the shared shape. Returns undefined for events we don't act on.
   * (The old switch used an untyped `reply` closure and DIRECT_MESSAGE_CREATE fell through
   * into the default branch, so guild DMs were never answered.)
   */
  private resolveContext(
    type: string,
    d: any,
  ):
    | {
        roomId: string;
        userId: string;
        userName: string;
        isDirect: boolean;
        mentionsBot: boolean;
        roomName?: string;
        kind: "group" | "dm";
        peer: string;
        inboundId: string;
      }
    | undefined {
    switch (type) {
      case "GROUP_AT_MESSAGE_CREATE":
      case "GROUP_MESSAGE_CREATE": {
        const userId = d.author?.member_openid ?? d.author?.id;
        return {
          roomId: `group:${d.group_openid}`,
          userId,
          userName: d.author?.username || shortName(userId),
          isDirect: false,
          mentionsBot: type === "GROUP_AT_MESSAGE_CREATE",
          roomName: "QQ group",
          kind: "group",
          peer: d.group_openid,
          inboundId: d.id,
        };
      }
      case "C2C_MESSAGE_CREATE": {
        const userId = d.author?.user_openid ?? d.author?.id;
        return {
          roomId: `c2c:${userId}`,
          userId,
          userName: d.author?.username || shortName(userId),
          isDirect: true,
          mentionsBot: true,
          kind: "dm",
          peer: userId,
          inboundId: d.id,
        };
      }
      case "AT_MESSAGE_CREATE":
        return {
          roomId: `channel:${d.channel_id}`,
          userId: d.author?.id,
          userName: d.member?.nick || d.author?.username || shortName(d.author?.id),
          isDirect: false,
          mentionsBot: true,
          roomName: "QQ guild channel",
          kind: "group",
          peer: d.channel_id,
          inboundId: d.id,
        };
      case "DIRECT_MESSAGE_CREATE":
        return {
          roomId: `dm:${d.guild_id}`,
          userId: d.author?.id,
          userName: d.author?.username || shortName(d.author?.id),
          isDirect: true,
          mentionsBot: true,
          kind: "dm",
          peer: d.guild_id,
          inboundId: d.id,
        };
      default:
        return undefined;
    }
  }

  /** Passive reply: quotes the inbound message, which is the only thing QQ always allows. */
  async replyTo(msg: IncomingMessage, text: string): Promise<void> {
    this.require("reply");
    const ctx = this.peerByRoom.get(msg.roomId);
    const chunks = splitMessage(qqSafeText(text), 1800);
    if (!ctx || !msg.ref) {
      await this.sendTo({ kind: msg.isDirect ? "dm" : "group", id: msg.roomId.replace(/^(group|c2c|channel|dm):/, ""), userId: msg.userId }, text);
      return;
    }
    for (const [i, chunk] of chunks.entries()) {
      const base = ctx.kind === "group" ? `/v2/groups/${ctx.peer}/messages` : `/v2/users/${ctx.peer}/messages`;
      await this.api("POST", base, { content: chunk, msg_type: 0, msg_id: msg.ref, msg_seq: i + 1 });
    }
  }

  /** Active send (no inbound message). QQ meters these per group/user, so it can be refused. */
  async sendTo(target: ChatTarget, text: string): Promise<void> {
    this.require("send");
    const peer = target.kind === "dm" ? (target.userId ?? target.id) : target.id;
    const path = target.kind === "dm" ? `/v2/users/${peer}/messages` : `/v2/groups/${peer}/messages`;
    for (const chunk of splitMessage(qqSafeText(text), 1800)) {
      await this.api("POST", path, { content: chunk, msg_type: 0 });
    }
  }
}

/**
 * QQ sends media as attachments, but the metadata is inconsistent in practice: emoji,
 * stickers and older clients often leave content_type empty or send octet-stream while the
 * filename (or the rich-media URL) says what it is. Classifying here — instead of requiring
 * a tidy `image/...` prefix — is the difference between the bot seeing a picture and the
 * bot replying "I got nothing".
 */
export type QQAttachmentKind = "image" | "video" | "audio" | "file" | "skip";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|heic|avif)$/i;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|avi|mkv)$/i;
const AUDIO_EXT = /\.(silk|amr|mp3|m4a|wav|ogg)$/i;

export function classifyAttachment(a: any): QQAttachmentKind {
  if (!a || typeof a !== "object") return "skip";
  const ct = String(a.content_type ?? a.contentType ?? "").toLowerCase().trim();
  const name = String(a.filename ?? a.file_name ?? a.name ?? "");
  const url = String(a.url ?? "");

  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  if (IMAGE_EXT.test(name)) return "image";
  if (VIDEO_EXT.test(name)) return "video";
  if (AUDIO_EXT.test(name)) return "audio";
  // Rich-media URLs carry a type hint when the metadata doesn't.
  if (/[?&](?:file_type=image|type=image)\b/i.test(url) || /\/image\//i.test(url)) return "image";
  if (/[?&](?:file_type=video|type=video)\b/i.test(url)) return "video";
  if (ct && ct !== "application/octet-stream") return "file";
  // No type, no filename, no hint: look at the extension in the URL path.
  if (IMAGE_EXT.test(url)) return "image";
  if (VIDEO_EXT.test(url)) return "video";
  return url || name ? "file" : "skip";
}

/** Absolute URL for an attachment, tolerating protocol-relative and bare-host forms. */
export function attachmentUrl(a: any): string {
  const raw = String(a?.url ?? a?.file_url ?? "").trim();
  if (!raw) return "";
  if (raw.startsWith("//")) return `https:${raw}`;
  if (/^https?:/i.test(raw)) return raw;
  return `https://${raw.replace(/^\/+/, "")}`;
}

/** Hostname only, so media-log lines never carry rkey tokens. */
function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "?";
  }
}

function fileHint(a: any): string {
  const name = String(a?.filename ?? a?.file_name ?? "");
  const type = String(a?.content_type ?? "");
  const bits = [type, name].filter(Boolean);
  return bits.length ? ` (${bits.join(", ").slice(0, 60)})` : "";
}

/**
 * QQ encoder markup: mentions (`<@!123>`) and legacy emoji (`<faceType=6,faceId="1",ext="…"/>`).
 * The emoji form carries a base64 JSON blob that means nothing to a model, so it becomes a
 * readable token instead of noise in the prompt.
 */
export function stripQQMarkup(text: string): string {
  return text
    .replace(/<@!?\d+>/g, " ")
    .replace(/<faceType=\d+,\s*faceId="\d+"(?:,\s*ext="[^"]*")?\s*\/?>/gi, "[emoji]")
    .replace(/<emoji:\d+>/gi, "[emoji]")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** Group and private-chat events only carry anonymous openids, not nicknames. */function shortName(openid: string | undefined): string {
  return openid ? `QQ user ${openid.slice(-4)}` : "QQ user";
}

/**
 * QQ rejects messages containing URLs whose domain isn't registered for the bot,
 * so drop source-link lines and render other URLs as plain text.
 */
export function qqSafeText(text: string): string {
  return text
    .split("\n")
    .filter((l) => !/^\s*🔗\s*https?:\/\//.test(l))
    .join("\n")
    .replace(/https?:\/\/([^\s/]+)[^\s)]*/g, (_m, host: string) => host.replace(/\./g, "[.]"))
    .trim();
}
