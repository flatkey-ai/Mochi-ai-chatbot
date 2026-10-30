import { Bot, type Context } from "grammy";
import type { Brain } from "../core/brain.ts";
import type { ImageInput, PlatformAdapter } from "../core/types.ts";
import { fetchAsDataUrl, splitMessage } from "./util.ts";

/**
 * Telegram adapter (long polling). To let Mochi read all group messages (for memory),
 * disable "Group Privacy" for the bot in @BotFather → Bot Settings.
 */
export class TelegramAdapter implements PlatformAdapter {
  readonly platform = "telegram" as const;
  private bot: Bot | null = null;
  private detail = "not started";
  private running = false;

  constructor(
    readonly botId: string,
    private readonly token: string,
    private readonly brain: Brain,
  ) {}

  async start(): Promise<void> {
    const bot = new Bot(this.token);
    await bot.init();
    const me = bot.botInfo;
    bot.on(["message:text", "message:photo"], (ctx) => void this.onMessage(ctx, me.id, me.username).catch((e) => console.error(`[telegram:${this.botId}]`, e)));
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
      const file = await ctx.api.getFile(largest.file_id);
      if (file.file_path) {
        const img = await fetchAsDataUrl(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`);
        if (img) images.push(img);
      }
    }

    if (isDirect || mentionsBot) void ctx.replyWithChatAction("typing").catch(() => {});
    const from = m.from;
    const reply = await this.brain.handle({
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
    });
    if (!reply) return;
    const chunks = splitMessage(reply.text, 4000);
    for (const [i, chunk] of chunks.entries()) {
      await ctx.reply(chunk, i === 0 ? { reply_parameters: { message_id: m.message_id } } : {});
    }
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
