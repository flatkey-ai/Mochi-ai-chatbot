import bolt from "@slack/bolt";
import type { Brain } from "../core/brain.ts";
import type { ImageInput, PlatformAdapter } from "../core/types.ts";
import { fetchAsDataUrl } from "./util.ts";

const { App, LogLevel } = bolt;

/**
 * Slack adapter (Socket Mode — no public URL needed).
 * Bot scopes: app_mentions:read, channels:history, groups:history, im:history,
 * chat:write, users:read, files:read. Events: message.channels, message.groups, message.im.
 */
export class SlackAdapter implements PlatformAdapter {
  readonly platform = "slack" as const;
  private app: InstanceType<typeof App> | null = null;
  private detail = "not started";
  private running = false;
  private botUserId = "";
  private names = new Map<string, string>();
  private channelNames = new Map<string, string>();

  constructor(
    readonly botId: string,
    private readonly botToken: string,
    private readonly appToken: string,
    private readonly brain: Brain,
  ) {}

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
      for (const f of Array.isArray(m.files) ? m.files : []) {
        if (!String(f.mimetype ?? "").startsWith("image/") || !f.url_private) continue;
        const img = await fetchAsDataUrl(f.url_private, { authorization: `Bearer ${this.botToken}` });
        if (img) images.push(img);
      }

      const reply = await this.brain.handle({
        botId: this.botId,
        platform: "slack",
        roomId: m.channel,
        roomName: isDirect ? undefined : await this.channelName(client, m.channel),
        userId: m.user,
        userName: await this.userName(client, m.user),
        text: text.replace(new RegExp(`<@${this.botUserId}>`, "g"), "").trim(),
        images,
        isDirect,
        mentionsBot,
        timestamp: Math.round(Number(m.ts) * 1000),
      });
      if (!reply) return;
      await say({ text: reply.text, thread_ts: m.thread_ts });
    });

    await app.start();
    this.app = app;
    this.running = true;
    this.detail = `bot user ${auth.user ?? this.botUserId}`;
    console.log(`[slack] connected as ${this.detail}`);
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
