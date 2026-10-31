import type { ChannelAdapter } from "../core/channel.ts";
import { UnsupportedCapability } from "../core/channel.ts";
import type { Brain } from "../core/brain.ts";
import type { Platform } from "../core/types.ts";
import { DiscordAdapter } from "../adapters/discord.ts";
import { TelegramAdapter } from "../adapters/telegram.ts";
import { SlackAdapter } from "../adapters/slack.ts";
import { QQAdapter } from "../adapters/qq.ts";
import { LineAdapter } from "../adapters/line.ts";

/** Platforms that have an adapter at all ("web" is served by the HTTP server). */
export type ChatPlatform = Exclude<Platform, "web">;

/** Credentials per platform, as stored by SecretsStore. */
export type AdapterCredentials =
  | { platform: "discord"; token: string }
  | { platform: "telegram"; token: string }
  | { platform: "slack"; botToken: string; appToken: string }
  | { platform: "qq"; appId: string; appSecret: string }
  | { platform: "line"; channelAccessToken: string; channelSecret: string };

type Builder = {
  [K in ChatPlatform]: (botId: string, creds: Extract<AdapterCredentials, { platform: K }>, brain: Brain) => ChannelAdapter;
};

/**
 * One place that knows how to build a channel. Adding a platform means adding an adapter
 * that extends ChannelAdapter and one line here — no more if-chains in the manager.
 */
const BUILDERS: Builder = {
  discord: (botId, c, brain) => new DiscordAdapter(botId, c.token, brain),
  telegram: (botId, c, brain) => new TelegramAdapter(botId, c.token, brain),
  slack: (botId, c, brain) => new SlackAdapter(botId, c.botToken, c.appToken, brain),
  qq: (botId, c, brain) => new QQAdapter(botId, c.appId, c.appSecret, brain),
  line: (botId, c, brain) => new LineAdapter(botId, c.channelAccessToken, c.channelSecret, brain),
};

export function isChatPlatform(p: string): p is ChatPlatform {
  return Object.prototype.hasOwnProperty.call(BUILDERS, p);
}

/** Build the adapter for a platform, or throw if that platform has none. */
export function createChannelAdapter(botId: string, creds: AdapterCredentials, brain: Brain): ChannelAdapter {
  const build = BUILDERS[creds.platform] as
    | ((botId: string, creds: AdapterCredentials, brain: Brain) => ChannelAdapter)
    | undefined;
  if (!build) throw new UnsupportedCapability(creds.platform as Platform, "send");
  return build(botId, creds, brain);
}

export const CHAT_PLATFORMS: ChatPlatform[] = Object.keys(BUILDERS) as ChatPlatform[];

/**
 * Static capability table for documentation and for the dashboard. Kept beside the
 * builders so "what can this channel do" has exactly one answer.
 */
export const CAPABILITY_MATRIX: Record<ChatPlatform, string[]> = {
  discord: ["reply", "send", "history", "media", "typing", "threads"],
  telegram: ["reply", "send", "media", "typing"],
  slack: ["reply", "send", "history", "media", "typing", "threads"],
  qq: ["reply", "send", "media"],
  // LINE replies with a one-shot replyToken and needs an HTTPS webhook; no history API.
  line: ["reply", "send", "media"],
};
