import { UnexpectedResponseError, networkProblem, unreachableMessage } from "../core/net-errors.ts";
import type { Brain } from "../core/brain.ts";
import type { BotRegistry, BotSettings } from "../core/bots.ts";
import type { ChannelCreds, ChannelPlatform, SecretsStore } from "../core/secrets.ts";
import { ChannelAdapter, type ChatTarget, type HistoryMessage, type PlatformAdapter } from "../core/channel.ts";
import { qqAccessToken } from "../adapters/qq.ts";
import { createChannelAdapter, type AdapterCredentials } from "./factory.ts";

export const CHANNEL_PLATFORMS: ChannelPlatform[] = ["discord", "telegram", "slack", "qq", "line"];

/**
 * Discord permissions used when the app itself doesn't pin any: View Channel, Send Messages,
 * Embed Links, Attach Files, Read Message History, Add Reactions (68608 also includes
 * Mention Everyone, which an invite shouldn't ask for — override it in the portal instead).
 */
const DISCORD_FALLBACK_PERMISSIONS = "68608";

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
          .then(() => {
            void this.syncProfile(bot, p).catch(() => {});
            // Backfill the persisted identity so the dashboard shows the account name and the
            // invite link after a restart too, not only in the moment of binding.
            if (!this.secrets.identity(botId, p)) void this.refreshIdentity(botId, p, creds);
          })
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
  /**
   * Deliver a webhook payload to a channel adapter. LINE is the only channel that needs this:
   * it has no socket, so the HTTP route hands the raw body here after checking the signature.
   * Returns false when that bot has no running adapter, so the route can answer 404.
   */
  async handleWebhook(botId: string, platform: ChannelPlatform, rawBody: string, signature?: string): Promise<boolean> {
    const adapter = this.running.get(`${botId}:${platform}`) as
      | (ChannelAdapter & { handleWebhook?: (body: string, sig?: string) => Promise<void> })
      | undefined;
    if (!adapter?.handleWebhook) return false;
    await adapter.handleWebhook(rawBody, signature);
    return true;
  }


  /** Ask the platform who we are and remember it (name + invite link) for the dashboard. */
  private async refreshIdentity(botId: string, platform: ChannelPlatform, creds: ChannelCreds): Promise<void> {
    try {
      const identity = await this.verify(platform, creds);
      this.identities.set(`${botId}:${platform}`, identity);
      this.secrets.setIdentity(botId, platform, identity);
    } catch (err) {
      console.log(`[${platform}:${botId}] could not refresh identity: ${(err as Error).message}`);
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
        identity: this.identities.get(key) ?? this.secrets.identity(botId, p),
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
        this.identities.set(key, identity); this.secrets.setIdentity(botId, platform, identity);
    if (!bot.channels[platform].enabled) this.bots.update(botId, { channels: { [platform]: { enabled: true } } });
    else await this.sync(botId);
    return this.status(botId).find((s) => s.platform === platform)!;
  }

  async unbind(botId: string, platform: ChannelPlatform): Promise<ChannelStatus> {
    this.secrets.setChannel(botId, platform, undefined);
    this.identities.delete(`${botId}:${platform}`);
    this.secrets.setIdentity(botId, platform, undefined);
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
        // An invite only adds a bot user when the app's Guild Install scopes include "bot".
        // Without it Discord authorises slash commands and silently leaves the bot out of the
        // server — which looks exactly like "it won't join".
        const installScopes: string[] = app?.install_params?.scopes ?? [];
        if (app && installScopes.length && !installScopes.includes("bot"))
          console.warn(
            `[discord] app ${appId} install scopes are [${installScopes.join(", ")}] — no "bot" scope, ` +
              `so invites only grant slash commands. Developer portal → Installation → Guild Install → Default Install Settings → add "bot".`,
          );
        // Build the invite from what the app itself is configured to allow: the developer portal
        // is the source of truth for scopes and permissions, so the link follows it instead of
        // carrying a copy-pasted constant that can silently disagree with the app.
        const scopes = [...new Set(["bot", ...installScopes, "applications.commands"])];
        const portalPerms = String(app?.install_params?.permissions ?? "");
        const permissions = /^\d+$/.test(portalPerms) && portalPerms !== "0" ? portalPerms : DISCORD_FALLBACK_PERMISSIONS;
        return {
          account: me.discriminator && me.discriminator !== "0" ? `${me.username}#${me.discriminator}` : me.username,
          link: `https://discord.com/oauth2/authorize?client_id=${appId}&scope=${encodeURIComponent(scopes.join(" "))}&permissions=${permissions}`,
        };
      }
      if (platform === "telegram") {
        const r = await this.getJson(`https://api.telegram.org/bot${creds.telegram!.token}/getMe`);
        if (r.ok === true && r.result?.username) return { account: `@${r.result.username}`, link: `https://t.me/${r.result.username}` };
        // Only 401 (Unauthorized) and 404 (no such bot) mean the token itself is wrong.
        if (r.error_code === 401 || r.error_code === 404) throw new Error("invalid");
        if (r.error_code === 429) throw new KnownError("Telegram is rate-limiting this server. Wait a minute and try again.");
        if (typeof r.ok !== "boolean") throw new UnexpectedResponseError(200);
        throw new KnownError(`Telegram couldn't check this token: ${String(r.description ?? r.error_code ?? "unknown error").slice(0, 160)}`);
      }
      if (platform === "qq") {
        // Credentials come from the dashboard binding (or .env for the first bot) and go to
        // QQ's own endpoints only — no env indirection, so a stray variable can't redirect them.
        let token: string;
        try {
          token = (await qqAccessToken(creds.qq!.appId, creds.qq!.appSecret, this.http)).token;
        } catch (err) {
          // A network/TLS failure is not a wrong AppSecret: rethrow it as-is so the catch below says which it is.
          if (networkProblem(err) || err instanceof TypeError) throw err;
          throw new Error(`invalid: ${(err as Error).message ?? ""}`);
        }
        const me = await this.getJson("https://api.sgroup.qq.com/users/@me", {
          headers: { authorization: `QQBot ${token}`, "x-union-appid": creds.qq!.appId },
        }).catch(() => null);
        return { account: me?.username ? `${me.username} (AppID ${creds.qq!.appId})` : `AppID ${creds.qq!.appId}`, link: "https://q.qq.com/" };
      }
        if (platform === "line") {
          const info = await this.getJson("https://api.line.me/v2/bot/info", {
            headers: { authorization: `Bearer ${creds.line!.channelAccessToken}` },
          }).catch(() => null);
          if (!info?.userId)
            throw new Error(
              "LINE rejected this channel access token. Copy the long-lived token from the Messaging API channel (Channel access token), not the channel secret.",
            );
          return {
            account: `@${info.basicId ?? info.userId}${info.displayName ? ` (${info.displayName})` : ""}`,
            link: "https://manager.line.biz/",
          };
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
      if (err instanceof KnownError || /Message Content|app-level|app token|bot token/.test(m)) throw new Error(m);
      // Couldn't reach the platform at all: never call that a wrong token.
      const net = networkProblem(err) ?? (err instanceof TypeError ? m || "fetch failed" : null);
      if (net) throw new Error(unreachableMessage(platform, net));
      if (platform === "qq") throw new Error("QQ rejected this AppID / AppSecret. Copy both again from q.qq.com → your bot → 开发管理 (Development) and retry.");
      throw new Error(`${cap(platform)} rejected this token. Copy it again from the ${platform === "telegram" ? "@BotFather chat" : "developer portal"} and retry.`);
    }
  }

  private async getJson(url: string, init: RequestInit = {}): Promise<any> {
    const res = await this.http(url, { ...init, signal: AbortSignal.timeout(15_000) });
    const text = await res.text().catch(() => "");
    let body: any;
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      // HTML or other non-JSON: a proxy, firewall or captive portal answered, not the platform.
      throw new UnexpectedResponseError(res.status);
    }
    if (!res.ok && !(body && typeof body === "object" && "ok" in body)) throw new Error(`HTTP ${res.status}`);
    return body;
  }

  /** One place builds adapters; see channels/factory.ts (add a platform = add a builder). */
  private makeAdapter(botId: string, p: ChannelPlatform, c: ChannelCreds): PlatformAdapter {
    const creds = toAdapterCredentials(p, c);
    if (!creds) throw new Error(`no credentials for ${p}`);
    return createChannelAdapter(botId, creds, this.brain);
  }

  /**
   * Read a room's older messages from the platform itself. Returns [] when that channel has
   * no history API or is not connected — callers then fall back to the local database.
   */
  async fetchHistory(botId: string, platform: ChannelPlatform, roomId: string, limit = 50): Promise<HistoryMessage[]> {
    const adapter = this.running.get(`${botId}:${platform}`);
    if (!adapter || !adapter.supports("history")) return [];
    const target = roomTarget(roomId);
    try {
      return await adapter.fetchHistory(target, limit);
    } catch (err) {
      console.log(`[${platform}:${botId}] history fetch failed: ${(err as Error).message}`);
      return [];
    }
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
  if (platform === "line") {
    const token = s("channelAccessToken");
    const secret = s("channelSecret");
    if (token.length < 40) throw new Error("That doesn't look like a LINE channel access token (it is very long).");
    if (secret.length < 16) throw new Error("The channel secret is on the same Messaging API page, under Channel secret.");
    return { line: { channelAccessToken: token, channelSecret: secret } };
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
    return [c.discord?.token, c.telegram?.token, c.slack?.botToken, c.slack?.appToken, c.qq?.appId, c.line?.channelAccessToken].filter(
      (t): t is string => Boolean(t),
    );
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(15_000),
});
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

/** Map stored credentials to the factory's discriminated union. */
function toAdapterCredentials(p: ChannelPlatform, c: ChannelCreds): AdapterCredentials | undefined {
  if (p === "discord" && c.discord) return { platform: "discord", token: c.discord.token };
  if (p === "telegram" && c.telegram) return { platform: "telegram", token: c.telegram.token };
  if (p === "slack" && c.slack) return { platform: "slack", botToken: c.slack.botToken, appToken: c.slack.appToken };
  if (p === "qq" && c.qq) return { platform: "qq", appId: c.qq.appId, appSecret: c.qq.appSecret };
  if (p === "line" && c.line)
    return { platform: "line", channelAccessToken: c.line.channelAccessToken, channelSecret: c.line.channelSecret };
  return undefined;
}

/** Room ids are namespaced ("group:123", "c2c:abc"); platform APIs want the bare id. */
export function roomTarget(roomId: string): ChatTarget {
  const m = /^(group|c2c|channel|dm):(.*)$/.exec(roomId);
  const kind: ChatTarget["kind"] = m && (m[1] === "c2c" || m[1] === "dm") ? "dm" : "group";
  const id = m ? m[2] : roomId;
  return { kind, id, userId: kind === "dm" ? id : undefined };
}

/** An error whose message is already the right thing to show the user. */
class KnownError extends Error {}
