import bolt from "@slack/bolt";
import type { Brain } from "../core/brain.ts";
import { ChannelAdapter, type ChannelCapability, type ChatTarget, type HistoryMessage } from "../core/channel.ts";
import type { ImageInput, IncomingMessage } from "../core/types.ts";
import { fetchAsDataUrl } from "./util.ts";

const { App, LogLevel } = bolt;

/**
 * Slack adapter (Socket Mode — no public URL needed).
 * Bot scopes: app_mentions:read, channels:history, channels:read, groups:history, im:history,
 * chat:write, users:read, files:read. Events: app_mention, message.channels, message.groups, message.im.
 */
export class SlackAdapter extends ChannelAdapter {
  readonly platform = "slack" as const;
  readonly capabilities: ReadonlySet<ChannelCapability> = new Set<ChannelCapability>([
    "reply",
    "send",
    "history",
    "media",
    "typing",
    "threads",
  ]);

  private app: InstanceType<typeof App> | null = null;
  private detail = "not started";
  private running = false;
  private botUserId = "";
  private names = new Map<string, string>();
  private channelNames = new Map<string, string>();
  /** Thread root per message, so a reply lands in the right thread (or none). */
  private readonly threadByRef = new Map<string, string | null>();

  constructor(
    botId: string,
    private readonly botToken: string,
    private readonly appToken: string,
    private readonly brain: Brain,
  ) {
    super(botId);
  }

  async start(): Promise<void> {
    const app = new App({ token: this.botToken, appToken: this.appToken, socketMode: true, logLevel: LogLevel.WARN });
    const auth = await app.client.auth.test();
    this.botUserId = String(auth.user_id ?? "");

    app.message(async ({ message, client, say }) => {
      const m = message as any;
      if (m.subtype && m.subtype !== "file_share") return;
      if (m.bot_id || !m.user || m.user === this.botUserId) return;

      const isDirect = m.channel_type === "im";
      const text: string = m.text ?? "";
      const mentionsBot = text.includes(`<@${this.botUserId}>`);

      const images: ImageInput[] = [];
      const notes: string[] = [];
      const files: any[] = Array.isArray(m.files) ? m.files : [];
      for (const f of files) {
        const mimetype = String(f.mimetype ?? "").toLowerCase();
        const filetype = String(f.filetype ?? "").toLowerCase();
        const isImage = mimetype.startsWith("image/") || /^(png|jpe?g|gif|webp|bmp|heic|avif)$/.test(filetype);
        const url = String(f.url_private_download ?? f.url_private ?? "");
        if (!isImage) {
          const name = String(f.name ?? f.title ?? filetype ?? "file").slice(0, 40);
          notes.push(`[sent a file (${name})]`);
          console.log(`[slack:${this.botId}] file ${filetype || mimetype || "?"} (not an image, not downloaded)`);
          continue;
        }
        if (!url) {
          notes.push("[sent an image, but Slack gave no download URL]");
          console.log(`[slack:${this.botId}] image without url_private`);
          continue;
        }
        const img = await fetchAsDataUrl(
          url,
          { authorization: `Bearer ${this.botToken}`, "user-agent": "mochi-ai-chatbot/0.2", accept: "image/*,*/*;q=0.8" },
          { expectMime: mimetype, via: `slack:${this.botId}` },
        );
        if (img) images.push(img);
        else notes.push("[sent an image, but it could not be downloaded]");
      }
      console.log(`[slack:${this.botId}] message ch=${m.channel} user=${m.user} files=${files.length} images=${images.length}`);

      const incoming: IncomingMessage = {
        botId: this.botId,
        platform: "slack",
        roomId: m.channel,
        roomName: isDirect ? undefined : await this.channelName(client, m.channel),
        userId: m.user,
        userName: await this.userName(client, m.user),
        text: [text.replace(new RegExp(`<@${this.botUserId}>`, "g"), "").trim(), ...notes].filter(Boolean).join("\n"),
        images,
        isDirect,
        mentionsBot,
        timestamp: Math.round(Number(m.ts) * 1000),
        ref: String(m.ts),
      };
      this.threadByRef.set(String(m.ts), m.thread_ts ?? null);
      if (this.threadByRef.size > 500) {
        const oldest = this.threadByRef.keys().next().value;
        if (oldest) this.threadByRef.delete(oldest);
      }

      const reply = await this.brain.handle(incoming);
      if (!reply) return;
      // `say` keeps Bolt's auth/retry handling; it is the same chat.postMessage underneath.
      const [first, ...rest] = reply.text.split(/(?<=\n)(?=.{1,3000})/s);
      await say({ text: first, thread_ts: m.thread_ts });
      for (const chunk of rest) if (chunk.trim()) await say({ text: chunk, thread_ts: m.thread_ts });
    });

    await app.start();
    this.app = app;
    this.running = true;
    this.detail = `bot user ${auth.user ?? this.botUserId}`;
    console.log(`[slack] connected as ${this.detail}`);
  }

  async replyTo(msg: IncomingMessage, text: string): Promise<void> {
    this.require("reply");
    const client = this.app?.client;
    if (!client) throw new Error("slack adapter is not started");
    const thread_ts = (msg.ref ? this.threadByRef.get(msg.ref) : undefined) ?? undefined;
    for (const chunk of splitSlack(text)) {
      await client.chat.postMessage({ channel: msg.roomId, text: chunk, ...(thread_ts ? { thread_ts } : {}) });
    }
  }

  async sendTo(target: ChatTarget, text: string): Promise<void> {
    this.require("send");
    const client = this.app?.client;
    if (!client) throw new Error("slack adapter is not started");
    const channel = target.kind === "dm" && target.userId ? target.userId : target.id;
    for (const chunk of splitSlack(text)) await client.chat.postMessage({ channel, text: chunk });
  }

  async fetchHistory(target: ChatTarget, limit: number): Promise<HistoryMessage[]> {
    this.require("history");
    const client = this.app?.client;
    if (!client) throw new Error("slack adapter is not started");
    const res: any = await client.conversations.history({ channel: target.id, limit: Math.min(200, Math.max(1, limit)) });
    const users = new Map<string, string>();
    const rows: HistoryMessage[] = [];
    for (const m of [...(res.messages ?? [])].reverse()) {
      if (!m.text) continue;
      const uid = m.user ?? m.bot_id ?? "unknown";
      if (!users.has(uid)) users.set(uid, await this.userName(client, uid));
      rows.push({
        userId: uid,
        userName: users.get(uid)!,
        text: String(m.text),
        ts: Math.round(Number(m.ts ?? 0) * 1000),
        isBot: Boolean(m.bot_id),
      });
    }
    return rows;
  }

  private async userName(client: any, id: string): Promise<string> {
    if (this.names.has(id)) return this.names.get(id)!;
    try {
      const r = await client.users.info({ user: id });
      const n = r.user?.profile?.display_name || r.user?.real_name || r.user?.name || id;
      this.names.set(id, n);
      return n;
    } catch {
      return id;
    }
  }

  private async channelName(client: any, id: string): Promise<string | undefined> {
    if (this.channelNames.has(id)) return this.channelNames.get(id);
    try {
      const r = await client.conversations.info({ channel: id });
      const n = r.channel?.name ? `#${r.channel.name}` : undefined;
      if (n) this.channelNames.set(id, n);
      return n;
    } catch {
      return undefined;
    }
  }

  async stop(): Promise<void> {
    await this.app?.stop();
    this.app = null;
    this.running = false;
    this.detail = "stopped";
  }

  status() {
    return { running: this.running, detail: this.detail };
  }
}

/** Slack rejects messages over ~4000 chars; split on blank lines first. */
function splitSlack(text: string, max = 3500): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf("\n\n", max);
    if (cut < max / 2) cut = rest.lastIndexOf("\n", max);
    if (cut < max / 2) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trimStart();
  }
  if (rest) out.push(rest);
  return out;
}
