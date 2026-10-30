import type { Brain } from "../core/brain.ts";
import type { BotRegistry, BotSettings } from "../core/bots.ts";
import type { ChannelCreds, ChannelPlatform, SecretsStore } from "../core/secrets.ts";
import type { PlatformAdapter } from "../core/types.ts";
import { DiscordAdapter } from "../adapters/discord.ts";
import { TelegramAdapter } from "../adapters/telegram.ts";
import { SlackAdapter } from "../adapters/slack.ts";
import { QQAdapter, qqAccessToken } from "../adapters/qq.ts";

export const CHANNEL_PLATFORMS: ChannelPlatform[] = ["discord", "telegram", "slack", "qq"];

export interface ChannelIdentity {
  /** Bot account name on the platform, e.g. "Mochi#1234" or "@mochi_bot". */
  account: string;
  /** Handy link: Discord invite URL, Telegram t.me link, Slack app page. */
  link?: string;
}

export interface ChannelStatus {
  platform: ChannelPlatform;
  bound: boolean;
  source: "dashboard" | "env" | null;
  enabled: boolean;
  running: boolean;
  detail: string;
  identity?: ChannelIdentity;
}

/** Legacy .env tokens. They apply to the default (first) bot only, unless it has dashboard tokens. */
export interface EnvChannelTokens {
  discord?: string;
  telegram?: string;
  slackBot?: string;
  slackApp?: string;
  qqAppId?: string;
  qqAppSecret?: string;
}

type Fetch = typeof fetch;
type AdapterFactory = (botId: string, p: ChannelPlatform, c: ChannelCreds) => PlatformAdapter;

export interface ChannelManagerOptions {
  env?: EnvChannelTokens;
  /** Overridable for tests. */
  http?: Fetch;
  factory?: AdapterFactory;
}

/**
 * Starts and stops each bot's Discord / Telegram / Slack connections, verifies tokens
 * before they're saved, and syncs the bot's description to platform profiles.
 */
export class ChannelManager {
  private running = new Map<string, PlatformAdapter>();
  private identities = new Map<string, ChannelIdentity>();
  private errors = new Map<string, string>();

  private readonly env: EnvChannelTokens;
  private readonly http: Fetch;
  private readonly factory: AdapterFactory;

  constructor(
    private readonly bots: BotRegistry,
    private readonly secrets: SecretsStore,
    private readonly brain: Brain,
    opts: ChannelManagerOptions = {},
  ) {
    this.env = opts.env ?? {};
    this.http = opts.http ?? fetch;
    this.factory = opts.factory ?? ((botId, p, c) => this.makeAdapter(botId, p, c));
    bots.onChange((bot, id) => {
      if (!bot) void this.stopBot(id);
      else void this.sync(bot.id);
    });
  }

  /** Credentials for a bot's channel: dashboard binding first, then legacy .env for the default bot. */
  creds(botId: string): { creds: ChannelCreds; source: Partial<Record<ChannelPlatform, "dashboard" | "env">> } {
    const dash = this.secrets.channels(botId);
    const creds: ChannelCreds = { ...dash };
    const source: Partial<Record<ChannelPlatform, "dashboard" | "env">> = {};
    for (const p of CHANNEL_PLATFORMS) if (dash[p]) source[p] = "dashboard";
    if (botId === this.bots.defaultBot().id) {
      if (!creds.discord && this.env.discord) (creds.discord = { token: this.env.discord }), (source.discord = "env");
      if (!creds.telegram && this.env.telegram) (creds.telegram = { token: this.env.telegram }), (source.telegram = "env");
      if (!creds.slack && this.env.slackBot && this.env.slackApp)
        (creds.slack = { botToken: this.env.slackBot, appToken: this.env.slackApp }), (source.slack = "env");
      if (!creds.qq && this.env.qqAppId && this.env.qqAppSecret)
        (creds.qq = { appId: this.env.qqAppId, appSecret: this.env.qqAppSecret }), (source.qq = "env");
    }
    return { creds, source };
  }

  async startAll(): Promise<void> {
    await Promise.all(this.bots.list().map((b) => this.sync(b.id)));
  }

  /** Bring a bot's running connections in line with its bindings + enabled toggles. */
  async sync(botId: string): Promise<void> {
    const bot = this.bots.get(botId);
    if (!bot) return this.stopBot(botId);
    const { creds } = this.creds(botId);
    for (const p of CHANNEL_PLATFORMS) {
      const key = `${botId}:${p}`;
      const want = Boolean(creds[p]) && bot.channels[p].enabled;
      const cur = this.running.get(key);
      if (want && !cur) {
        const a = this.factory(botId, p, creds);
        this.running.set(key, a);
        this.errors.delete(key);
        a.start()
          .then(() => this.syncProfile(bot, p).catch(() => {}))
          .catch((err) => {
            console.error(`[${p}:${botId}] failed to start:`, err?.message ?? err);
            this.errors.set(key, String(err?.message ?? err).slice(0, 200));
            this.running.delete(key);
          });
      } else if (!want && cur) {
        this.running.delete(key);
        await cur.stop().catch(() => {});
      }
    }
  }

  async stopBot(botId: string): Promise<void> {
    for (const p of CHANNEL_PLATFORMS) {
      const key = `${botId}:${p}`;
      const a = this.running.get(key);
      if (a) {
        this.running.delete(key);
        await a.stop().catch(() => {});
      }
    }
  }

  async stopAll(): Promise<void> {
    await Promise.allSettled([...this.running.values()].map((a) => a.stop()));
    this.running.clear();
  }

  status(botId: string): ChannelStatus[] {
    const bot = this.bots.get(botId);
    const { creds, source } = this.creds(botId);
    return CHANNEL_PLATFORMS.map((p) => {
      const key = `${botId}:${p}`;
      const a = this.running.get(key);
      const st = a?.status();
      return {
        platform: p,
        bound: Boolean(creds[p]),
        source: source[p] ?? null,
        enabled: Boolean(bot?.channels[p].enabled),
        running: Boolean(st?.running),
        detail: this.errors.get(key) ?? st?.detail ?? (creds[p] ? "stopped" : "not connected"),
        identity: this.identities.get(key),
      };
    });
  }

  /** Verify credentials with the platform, then save and start. Throws a user-friendly error if invalid. */
  async bind(botId: string, platform: ChannelPlatform, input: Record<string, unknown>): Promise<ChannelStatus> {
    const bot = this.bots.get(botId);
    if (!bot) throw new Error("bot not found");
    const creds = parseCreds(platform, input);
    for (const t of tokensOf(creds)) {
      const other = this.secrets.findBotUsingToken(t);
      if (other && other.botId !== botId) {
        const name = this.bots.get(other.botId)?.persona.name ?? other.botId;
        throw new Error(`This token is already connected to "${name}". Each platform bot account can serve one Mochi bot.`);
      }
    }
    const identity = await this.verify(platform, creds);
    // Restart with the new token.
    const key = `${botId}:${platform}`;
    const cur = this.running.get(key);
    if (cur) {
      this.running.delete(key);
      await cur.stop().catch(() => {});
    }
    this.secrets.setChannel(botId, platform, creds[platform] as never);
    this.identities.set(key, identity);
    if (!bot.channels[platform].enabled) this.bots.update(botId, { channels: { [platform]: { enabled: true } } });
    else await this.sync(botId);
    return this.status(botId).find((s) => s.platform === platform)!;
  }

  async unbind(botId: string, platform: ChannelPlatform): Promise<ChannelStatus> {
    this.secrets.setChannel(botId, platform, undefined);
    this.identities.delete(`${botId}:${platform}`);
    await this.sync(botId);
    return this.status(botId).find((s) => s.platform === platform)!;
  }

  /** Push the bot's description to platforms that show one on the bot's profile. */
  async syncProfile(bot: BotSettings, only?: ChannelPlatform): Promise<void> {
    const { creds } = this.creds(bot.id);
    const desc = bot.persona.description.trim();
    if (creds.telegram && (!only || only === "telegram")) {
      const base = `https://api.telegram.org/bot${creds.telegram.token}`;
      await this.http(`${base}/setMyDescription`, json({ description: desc.slice(0, 512) })).catch(() => {});
      await this.http(`${base}/setMyShortDescription`, json({ short_description: desc.slice(0, 120) })).catch(() => {});
    }
    if (creds.discord && (!only || only === "discord")) {
      await this.http("https://discord.com/api/v10/applications/@me", {
        method: "PATCH",
        headers: { authorization: `Bot ${creds.discord.token}`, "content-type": "application/json" },
        body: JSON.stringify({ description: desc.slice(0, 400) }),
      }).catch(() => {});
    }
  }

  private async verify(platform: ChannelPlatform, creds: ChannelCreds): Promise<ChannelIdentity> {
    try {
      if (platform === "discord") {
        const h = { authorization: `Bot ${creds.discord!.token}` };
        const me = await this.getJson("https://discord.com/api/v10/users/@me", { headers: h });
        const app = await this.getJson("https://discord.com/api/v10/applications/@me", { headers: h }).catch(() => null);
        const flags = Number(app?.flags ?? 0);
        // GATEWAY_MESSAGE_CONTENT (1<<18) or _LIMITED (1<<19) must be on to read group messages.
        if (app && !(flags & (1 << 18)) && !(flags & (1 << 19)))
          throw new Error('Turn on "Message Content Intent" under Bot → Privileged Gateway Intents in the Discord developer portal, then try again.');
        const appId = app?.id ?? me.id;
        return {
          account: me.discriminator && me.discriminator !== "0" ? `${me.username}#${me.discriminator}` : me.username,
          link: `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot&permissions=68608`,
        };
      }
      if (platform === "telegram") {
        const r = await this.getJson(`https://api.telegram.org/bot${creds.telegram!.token}/getMe`);
        if (!r.ok) throw new Error("invalid");
        return { account: `@${r.result.username}`, link: `https://t.me/${r.result.username}` };
      }
      if (platform === "qq") {
        const { token } = await qqAccessToken(creds.qq!.appId, creds.qq!.appSecret, this.http).catch(() => {
          throw new Error("invalid");
        });
        const me = await this.getJson("https://api.sgroup.qq.com/users/@me", {
          headers: { authorization: `QQBot ${token}`, "x-union-appid": creds.qq!.appId },
        }).catch(() => null);
        return { account: me?.username ? `${me.username} (AppID ${creds.qq!.appId})` : `AppID ${creds.qq!.appId}`, link: "https://q.qq.com/" };
      }
      const auth = await this.getJson("https://slack.com/api/auth.test", {
        method: "POST",
        headers: { authorization: `Bearer ${creds.slack!.botToken}` },
      });
      if (!auth.ok) throw new Error(`bot token: ${auth.error}`);
      const conn = await this.getJson("https://slack.com/api/apps.connections.open", {
        method: "POST",
        headers: { authorization: `Bearer ${creds.slack!.appToken}` },
      });
      if (!conn.ok)
        throw new Error(
          conn.error === "not_allowed_token_type"
            ? "The app-level token must start with xapp- and have the connections:write scope."
            : `app token: ${conn.error}. Make sure Socket Mode is on.`,
        );
      return { account: `@${auth.user} in ${auth.team}`, link: auth.url };
    } catch (err) {
      const m = (err as Error).message;
      if (/Message Content|app-level|app token|bot token/.test(m)) throw new Error(m);
      if (platform === "qq") throw new Error("QQ rejected this AppID / AppSecret. Copy both again from q.qq.com → your bot → 开发管理 (Development) and retry.");
      throw new Error(`${cap(platform)} rejected this token. Copy it again from the ${platform === "telegram" ? "@BotFather chat" : "developer portal"} and retry.`);
    }
  }

  private async getJson(url: string, init: RequestInit = {}): Promise<any> {
    const res = await this.http(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok && !("ok" in body)) throw new Error(`HTTP ${res.status}`);
    return body;
  }

  private makeAdapter(botId: string, p: ChannelPlatform, c: ChannelCreds): PlatformAdapter {
    if (p === "discord") return new DiscordAdapter(botId, c.discord!.token, this.brain);
    if (p === "telegram") return new TelegramAdapter(botId, c.telegram!.token, this.brain);
    if (p === "qq") return new QQAdapter(botId, c.qq!.appId, c.qq!.appSecret, this.brain);
    return new SlackAdapter(botId, c.slack!.botToken, c.slack!.appToken, this.brain);
  }
}

function parseCreds(platform: ChannelPlatform, input: Record<string, unknown>): ChannelCreds {
  const s = (k: string) => String(input[k] ?? "").trim();
  if (platform === "discord") {
    if (s("token").length < 30) throw new Error("Paste the bot token from Discord → your app → Bot → Reset Token.");
    return { discord: { token: s("token") } };
  }
  if (platform === "telegram") {
    if (!/^\d+:[\w-]{20,}$/.test(s("token"))) throw new Error("A Telegram bot token looks like 123456789:AA… (from @BotFather).");
    return { telegram: { token: s("token") } };
  }
  if (platform === "qq") {
    if (!/^\d{5,}$/.test(s("appId"))) throw new Error("The QQ AppID is a number, e.g. 102012345 (q.qq.com → 开发管理).");
    if (s("appSecret").length < 8) throw new Error("Paste the AppSecret from q.qq.com → 开发管理 (Development).");
    return { qq: { appId: s("appId"), appSecret: s("appSecret") } };
  }
  if (!s("botToken").startsWith("xoxb-")) throw new Error("The Slack bot token starts with xoxb-.");
  if (!s("appToken").startsWith("xapp-")) throw new Error("The Slack app-level token starts with xapp-.");
  return { slack: { botToken: s("botToken"), appToken: s("appToken") } };
}

function tokensOf(c: ChannelCreds): string[] {
  return [c.discord?.token, c.telegram?.token, c.slack?.botToken, c.slack?.appToken, c.qq?.appId].filter((t): t is string => Boolean(t));
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(15_000),
});
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
