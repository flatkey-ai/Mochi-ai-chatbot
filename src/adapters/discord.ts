import { ChannelType, Client, Events, GatewayIntentBits, Partials, type Message } from "discord.js";
import type { Brain } from "../core/brain.ts";
import { ChannelAdapter, type ChannelCapability, type ChatTarget, type HistoryMessage } from "../core/channel.ts";
import type { ImageInput, IncomingMessage } from "../core/types.ts";
import { splitMessage } from "./util.ts";

/**
 * Discord adapter. In the Discord developer portal, enable the "Message Content" privileged intent
 * so Mochi can read group messages (needed for memory, not only for replies).
 */
export class DiscordAdapter extends ChannelAdapter {
  readonly platform = "discord" as const;
  readonly capabilities: ReadonlySet<ChannelCapability> = new Set<ChannelCapability>([
    "reply",
    "send",
    "history",
    "media",
    "typing",
    "threads",
  ]);

  private client: Client | null = null;
  private detail = "not started";
  /** Message id → message, so replyTo() can quote the exact one that was asked about. */
  private readonly messageByRef = new Map<string, Message>();

  constructor(
    botId: string,
    private readonly token: string,
    private readonly brain: Brain,
  ) {
    super(botId);
  }

  async start(): Promise<void> {
    const client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
      partials: [Partials.Channel],
    });
    client.once(Events.ClientReady, (c) => {
      this.detail = `logged in as ${c.user.tag}`;
      console.log(`[discord] ${this.detail}`);
    });
    client.on(Events.MessageCreate, (m) => void this.onMessage(m).catch((e) => console.error(`[discord:${this.botId}]`, e)));
    await client.login(this.token);
    this.client = client;
  }

  private async onMessage(m: Message): Promise<void> {
    if (m.author.bot || !this.client?.user) return;
    const me = this.client.user;
    const isDirect = m.channel.type === ChannelType.DM;
    const repliedToBot = m.reference?.messageId
      ? (await m.fetchReference().catch(() => null))?.author.id === me.id
      : false;

    const images: ImageInput[] = [...m.attachments.values()]
      .filter((a) => a.contentType?.startsWith("image/"))
      .map((a) => ({ url: a.url, mimeType: a.contentType ?? undefined }));

    const text = m.content.replace(new RegExp(`<@!?${me.id}>`, "g"), "").trim();
    const roomName = "name" in m.channel && m.channel.name ? `#${m.channel.name}` : undefined;

    const sendTyping = () => ("sendTyping" in m.channel ? m.channel.sendTyping().catch(() => {}) : undefined);
    const typing = setInterval(sendTyping, 8000);
    const mentionsBot = m.mentions.users.has(me.id) || repliedToBot;
    if (isDirect || mentionsBot) void sendTyping();

    const incoming: IncomingMessage = {
      botId: this.botId,
      platform: "discord",
      roomId: m.channelId,
      roomName: m.guild ? `${m.guild.name} ${roomName ?? ""}`.trim() : roomName,
      userId: m.author.id,
      userName: m.member?.displayName ?? m.author.globalName ?? m.author.username,
      text,
      images,
      isDirect,
      mentionsBot,
      timestamp: m.createdTimestamp,
      ref: m.id,
    };
    this.messageByRef.set(m.id, m);
    if (this.messageByRef.size > 500) {
      const oldest = this.messageByRef.keys().next().value;
      if (oldest) this.messageByRef.delete(oldest);
    }

    try {
      const reply = await this.brain.handle(incoming);
      if (reply) await this.replyTo(incoming, reply.text);
    } finally {
      clearInterval(typing);
    }
  }

  async replyTo(msg: IncomingMessage, text: string): Promise<void> {
    this.require("reply");
    const chunks = splitMessage(text, 1900);
    const source = msg.ref ? this.messageByRef.get(msg.ref) : undefined;
    if (!source) {
      await this.sendTo({ kind: msg.isDirect ? "dm" : "group", id: msg.roomId, userId: msg.userId, name: msg.roomName }, text);
      return;
    }
    const [first, ...rest] = chunks;
    await source.reply({ content: first, allowedMentions: { repliedUser: false } });
    for (const chunk of rest) if ("send" in source.channel) await source.channel.send(chunk);
  }

  async sendTo(target: ChatTarget, text: string): Promise<void> {
    this.require("send");
    const client = this.client;
    if (!client) throw new Error("discord adapter is not started");
    const chunks = splitMessage(text, 1900);
    if (target.kind === "dm" && target.userId) {
      const user = await client.users.fetch(target.userId);
      const dm = await user.createDM();
      for (const chunk of chunks) await dm.send(chunk);
      return;
    }
    const channel = await client.channels.fetch(target.id);
    if (!channel || !("send" in channel)) throw new Error(`discord channel ${target.id} is not text-capable`);
    for (const chunk of chunks) await (channel as any).send(chunk);
  }

  async fetchHistory(target: ChatTarget, limit: number): Promise<HistoryMessage[]> {
    this.require("history");
    const client = this.client;
    if (!client) throw new Error("discord adapter is not started");
    const channel: any = await client.channels.fetch(target.id).catch(() => null);
    if (!channel?.messages) return [];
    const fetched = await channel.messages.fetch({ limit: Math.min(100, Math.max(1, limit)) });
    return [...fetched.values()]
      .reverse()
      .map((m: Message) => ({
        userId: m.author.id,
        userName: m.member?.displayName ?? m.author.globalName ?? m.author.username,
        text: m.content,
        ts: m.createdTimestamp,
        isBot: m.author.bot,
      }));
  }

  async stop(): Promise<void> {
    await this.client?.destroy();
    this.client = null;
    this.detail = "stopped";
  }

  status() {
    return { running: Boolean(this.client?.isReady()), detail: this.detail };
  }
}
