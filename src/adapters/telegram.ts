import { Bot, type Context } from "grammy";
import type { Brain } from "../core/brain.ts";
import { ChannelAdapter, type ChannelCapability, type ChatTarget, type HistoryMessage } from "../core/channel.ts";
import type { ImageInput, IncomingMessage } from "../core/types.ts";
import { fetchAsDataUrl, splitMessage } from "./util.ts";
import { proxyAgent } from "../core/proxy.ts";

/**
 * Telegram adapter (long polling). To let Mochi read all group messages (for memory),
 * disable "Group Privacy" for the bot in @BotFather → Bot Settings.
 *
 * The Bot API has no "read history" endpoint, so this channel declares "history" as
 * unsupported and Mochi falls back to its own database for older messages.
 */
export class TelegramAdapter extends ChannelAdapter {
  readonly platform = "telegram" as const;
  readonly capabilities: ReadonlySet<ChannelCapability> = new Set<ChannelCapability>([
    "reply",
    "send",
    "media",
    "typing",
  ]);

  private bot: Bot | null = null;
  private detail = "not started";
  private running = false;
  /** Last message per chat, so replyTo() can attach a reply_to_message. */
  private readonly lastByRoom = new Map<string, { chatId: number; messageId: number }>();

  constructor(
    botId: string,
    private readonly token: string,
    private readonly brain: Brain,
  ) {
    super(botId);
  }

  async start(): Promise<void> {
    // Node ignores the OS proxy; if HTTPS_PROXY is set, send Telegram traffic through it.
    const agent = proxyAgent();
    const bot = new Bot(this.token, agent ? { client: { baseFetchConfig: { agent, compress: true } } } : undefined);
    await bot.init();
    const me = bot.botInfo;
    bot.on(["message:text", "message:photo"], (ctx) =>
      void this.onMessage(ctx, me.id, me.username).catch((e) => console.error(`[telegram:${this.botId}]`, e)),
    );
    bot.catch((err) => console.error(`[telegram:${this.botId}]`, err.message));
    this.bot = bot;
    this.detail = `@${me.username}`;
    this.running = true;
    void bot.start({ drop_pending_updates: true, onStart: () => console.log(`[telegram] polling as @${me.username}`) }).finally(() => {
      this.running = false;
    });
  }

  private async onMessage(ctx: Context, tgBotId: number, username: string): Promise<void> {
    const m = ctx.message;
    if (!m || !m.from || m.from.is_bot) return;
    const raw = m.text ?? m.caption ?? "";
    const isDirect = m.chat.type === "private";
    const mentionsBot =
      raw.toLowerCase().includes(`@${username.toLowerCase()}`) || m.reply_to_message?.from?.id === tgBotId;

    const images: ImageInput[] = [];
    if (m.photo?.length) {
      const largest = m.photo[m.photo.length - 1];
      const file = await ctx.api.getFile(largest.file_id).catch(() => null);
      if (file?.file_path) {
        // The URL embeds the bot token, which is why it is inlined rather than handed to a model.
        const img = await fetchAsDataUrl(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`, {}, { expectMime: "image/jpeg", via: `telegram:${this.botId}` });
        if (img) images.push(img);
      }
    }

    if (isDirect || mentionsBot) void ctx.replyWithChatAction("typing").catch(() => {});
    const from = m.from;
    const incoming: IncomingMessage = {
      botId: this.botId,
      platform: "telegram",
      roomId: String(m.chat.id),
      roomName: "title" in m.chat ? m.chat.title : undefined,
      userId: String(from.id),
      userName: [from.first_name, from.last_name].filter(Boolean).join(" ") || from.username || "someone",
      text: raw.replace(new RegExp(`@${username}`, "ig"), "").trim(),
      images,
      isDirect,
      mentionsBot,
      timestamp: m.date * 1000,
      ref: String(m.message_id),
    };
    this.lastByRoom.set(incoming.roomId, { chatId: m.chat.id, messageId: m.message_id });

    const reply = await this.brain.handle(incoming);
    if (reply) await this.replyTo(incoming, reply.text);
  }

  async replyTo(msg: IncomingMessage, text: string): Promise<void> {
    this.require("reply");
    const bot = this.bot;
    if (!bot) throw new Error("telegram adapter is not started");
    const chunks = splitMessage(text, 4000);
    const source = msg.ref ? { messageId: Number(msg.ref) } : this.lastByRoom.get(msg.roomId);
    const chatId = Number(msg.roomId);
    for (const [i, chunk] of chunks.entries()) {
      const extra = i === 0 && source ? { reply_parameters: { message_id: source.messageId } } : {};
      await bot.api.sendMessage(Number.isFinite(chatId) ? chatId : msg.roomId, chunk, extra as any);
    }
  }

  async sendTo(target: ChatTarget, text: string): Promise<void> {
    this.require("send");
    const bot = this.bot;
    if (!bot) throw new Error("telegram adapter is not started");
    const chatId = target.kind === "dm" && target.userId ? Number(target.userId) : Number(target.id);
    const peer = Number.isFinite(chatId) ? chatId : target.kind === "dm" ? target.userId : target.id;
    for (const chunk of splitMessage(text, 4000)) await bot.api.sendMessage(peer as any, chunk);
  }

  /** The Bot API can't read history; say so instead of pretending the room is empty. */
  async fetchHistory(_target: ChatTarget, _limit: number): Promise<HistoryMessage[]> {
    this.require("history");
    return [];
  }

  async stop(): Promise<void> {
    await this.bot?.stop();
    this.bot = null;
    this.running = false;
    this.detail = "stopped";
  }

  status() {
    return { running: this.running, detail: this.detail };
  }
}
