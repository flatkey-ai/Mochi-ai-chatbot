import { ChannelType, Client, Events, GatewayIntentBits, Partials, type Message } from "discord.js";
import type { Brain } from "../core/brain.ts";
import type { ImageInput, PlatformAdapter } from "../core/types.ts";
import { splitMessage } from "./util.ts";

/**
 * Discord adapter. In the Discord developer portal, enable the "Message Content" privileged intent
 * so Mochi can read group messages (needed for memory, not only for replies).
 */
export class DiscordAdapter implements PlatformAdapter {
  readonly platform = "discord" as const;
  private client: Client | null = null;
  private detail = "not started";

  constructor(
    private readonly token: string,
    private readonly brain: Brain,
  ) {}

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
    client.on(Events.MessageCreate, (m) => void this.onMessage(m).catch((e) => console.error("[discord]", e)));
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

    try {
      const reply = await this.brain.handle({
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
      });
      if (!reply) return;
      const [first, ...rest] = splitMessage(reply.text, 1900);
      await m.reply({ content: first, allowedMentions: { repliedUser: false } });
      for (const chunk of rest) if ("send" in m.channel) await m.channel.send(chunk);
    } finally {
      clearInterval(typing);
    }
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
