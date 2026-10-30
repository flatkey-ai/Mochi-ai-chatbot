import fs from "node:fs";
import path from "node:path";

export interface ChannelCreds {
  discord?: { token: string };
  telegram?: { token: string };
  slack?: { botToken: string; appToken: string };
  qq?: { appId: string; appSecret: string };
}
export type ChannelPlatform = keyof ChannelCreds;

interface SecretsFile {
  flatkeyApiKey?: string;
  /** Channel tokens per bot id. */
  channels?: Record<string, ChannelCreds>;
}

/**
 * Secrets bound from the dashboard: the Flatkey API key and each bot's channel tokens.
 * Stored in DATA_DIR/secrets.json with 0600 permissions, never in bots.json,
 * and never returned to the browser (only masked previews).
 */
export class SecretsStore {
  private readonly file: string;
  private data: SecretsFile = {};

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "secrets.json");
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, "utf8"));
    } catch {
      this.data = {};
    }
  }

  get flatkeyApiKey(): string | undefined {
    return this.data.flatkeyApiKey || undefined;
  }

  setFlatkeyApiKey(key: string | undefined): void {
    if (key) this.data.flatkeyApiKey = key;
    else delete this.data.flatkeyApiKey;
    this.save();
  }

  channels(botId: string): ChannelCreds {
    return this.data.channels?.[botId] ?? {};
  }

  setChannel<P extends ChannelPlatform>(botId: string, platform: P, creds: ChannelCreds[P] | undefined): void {
    this.data.channels ??= {};
    const cur = (this.data.channels[botId] ??= {});
    if (creds) cur[platform] = creds;
    else delete cur[platform];
    if (!Object.keys(cur).length) delete this.data.channels[botId];
    this.save();
  }

  deleteBot(botId: string): void {
    if (this.data.channels?.[botId]) {
      delete this.data.channels[botId];
      this.save();
    }
  }

  /** Which bot (if any) already uses this token, so one token can't be bound twice. */
  findBotUsingToken(token: string): { botId: string; platform: ChannelPlatform } | undefined {
    for (const [botId, c] of Object.entries(this.data.channels ?? {})) {
      if (c.discord?.token === token) return { botId, platform: "discord" };
      if (c.telegram?.token === token) return { botId, platform: "telegram" };
      if (c.slack?.botToken === token || c.slack?.appToken === token) return { botId, platform: "slack" };
      if (c.qq?.appId === token) return { botId, platform: "qq" };
    }
    return undefined;
  }

  private save(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* best effort on filesystems without chmod */
    }
  }
}

export function maskKey(key: string | undefined): string {
  if (!key) return "";
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}
