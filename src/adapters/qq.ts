import type { Brain } from "../core/brain.ts";
import type { ImageInput, PlatformAdapter } from "../core/types.ts";
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

export class QQAdapter implements PlatformAdapter {
  readonly platform = "qq" as const;
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

  constructor(
    readonly botId: string,
    private readonly appId: string,
    private readonly appSecret: string,
    private readonly brain: Brain,
    endpoints: QQEndpoints = {},
  ) {
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
    let roomId: string, userId: string, userName: string, isDirect: boolean, mentionsBot: boolean, roomName: string | undefined;
    let reply: (content: string, seq: number) => Promise<unknown>;

    switch (type) {
      case "GROUP_AT_MESSAGE_CREATE":
      case "GROUP_MESSAGE_CREATE":
        roomId = `group:${d.group_openid}`;
        userId = d.author?.member_openid ?? d.author?.id;
        userName = d.author?.username || shortName(userId);
        isDirect = false;
        mentionsBot = type === "GROUP_AT_MESSAGE_CREATE";
        roomName = "QQ group";
        reply = (content, seq) => this.api("POST", `/v2/groups/${d.group_openid}/messages`, { content, msg_type: 0, msg_id: d.id, msg_seq: seq });
        break;
      case "C2C_MESSAGE_CREATE":
        userId = d.author?.user_openid ?? d.author?.id;
        roomId = `c2c:${userId}`;
        userName = d.author?.username || shortName(userId);
        isDirect = true;
        mentionsBot = true;
        reply = (content, seq) => this.api("POST", `/v2/users/${userId}/messages`, { content, msg_type: 0, msg_id: d.id, msg_seq: seq });
        break;
      case "AT_MESSAGE_CREATE":
        roomId = `channel:${d.channel_id}`;
        userId = d.author?.id;
        userName = d.member?.nick || d.author?.username || shortName(userId);
        isDirect = false;
        mentionsBot = true;
        roomName = "QQ guild channel";
        reply = (content) => this.api("POST", `/channels/${d.channel_id}/messages`, { content, msg_id: d.id });
        break;
      case "DIRECT_MESSAGE_CREATE":
        roomId = `dm:${d.guild_id}`;
        userId = d.author?.id;
        userName = d.author?.username || shortName(userId);
        isDirect = true;
        mentionsBot = true;
        reply = (content) => this.api("POST", `/dms/${d.guild_id}/messages`, { content, msg_id: d.id });
        break;
      default:
        return;
    }
    if (!userId) return;

    const images: ImageInput[] = [];
    for (const a of Array.isArray(d.attachments) ? d.attachments : []) {
      if (!String(a?.content_type ?? "").startsWith("image/") || !a.url) continue;
      const url = String(a.url).startsWith("//") ? `https:${a.url}` : /^https?:/.test(a.url) ? a.url : `https://${a.url}`;
      const img = await fetchAsDataUrl(url);
      if (img) images.push(img);
    }

    const answer = await this.brain.handle({
      botId: this.botId,
      platform: "qq",
      roomId,
      roomName,
      userId,
      userName,
      text: String(d.content ?? "").replace(/<@!?\d+>/g, "").trim(),
      images,
      isDirect,
      mentionsBot,
      timestamp: d.timestamp ? Date.parse(d.timestamp) || undefined : undefined,
    });
    if (!answer) return;
    const chunks = splitMessage(qqSafeText(answer.text), 1800);
    for (const [i, chunk] of chunks.entries()) await reply(chunk, i + 1);
  }
}

/** Group and private-chat events only carry anonymous openids, not nicknames. */
function shortName(openid: string | undefined): string {
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
