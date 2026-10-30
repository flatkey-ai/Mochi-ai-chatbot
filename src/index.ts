import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Brain } from "./core/brain.ts";
import { SettingsStore } from "./core/settings.ts";
import type { Platform, PlatformAdapter } from "./core/types.ts";
import { FlatkeyClient } from "./flatkey/client.ts";
import { MemoryStore } from "./memory/store.ts";
import { MemoryUpdater } from "./memory/updater.ts";
import { SearchAbility } from "./abilities/search.ts";
import { DiscordAdapter } from "./adapters/discord.ts";
import { TelegramAdapter } from "./adapters/telegram.ts";
import { SlackAdapter } from "./adapters/slack.ts";
import { createServer } from "./server/app.ts";

const env = process.env;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!env.FLATKEY_API_KEY) {
  console.error("Missing FLATKEY_API_KEY. Copy .env.example to .env and add your key from https://console.flatkey.ai/keys");
  process.exit(1);
}
if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN === "change-me") {
  console.warn("[mochi] ADMIN_TOKEN is not set or is the default. Set a strong one before exposing the dashboard.");
}

const dataDir = path.resolve(env.DATA_DIR || path.join(root, "data"));
fs.mkdirSync(dataDir, { recursive: true });

const settings = new SettingsStore(dataDir);
const store = new MemoryStore(dataDir);
const flatkey = new FlatkeyClient(env.FLATKEY_API_KEY, env.FLATKEY_BASE_URL || undefined);
const getSettings = () => settings.get();
const updater = new MemoryUpdater(flatkey, store, getSettings);
const search = new SearchAbility(flatkey, getSettings);
const brain = new Brain({ flatkey, store, updater, search, getSettings });

// ── platform adapters: started/stopped live from the dashboard toggles ──
const factories: Partial<Record<Platform, () => PlatformAdapter>> = {};
if (env.DISCORD_BOT_TOKEN) factories.discord = () => new DiscordAdapter(env.DISCORD_BOT_TOKEN!, brain);
if (env.TELEGRAM_BOT_TOKEN) factories.telegram = () => new TelegramAdapter(env.TELEGRAM_BOT_TOKEN!, brain);
if (env.SLACK_BOT_TOKEN && env.SLACK_APP_TOKEN)
  factories.slack = () => new SlackAdapter(env.SLACK_BOT_TOKEN!, env.SLACK_APP_TOKEN!, brain);

const running: Partial<Record<Platform, PlatformAdapter>> = {};

async function syncAdapters(): Promise<void> {
  const s = settings.get();
  for (const p of ["discord", "telegram", "slack"] as const) {
    const want = Boolean(factories[p]) && s.platforms[p].enabled;
    if (want && !running[p]) {
      const a = factories[p]!();
      running[p] = a;
      a.start().catch((err) => {
        console.error(`[${p}] failed to start:`, err?.message ?? err);
        delete running[p];
      });
    } else if (!want && running[p]) {
      const a = running[p]!;
      delete running[p];
      await a.stop().catch(() => {});
      console.log(`[${p}] stopped from dashboard`);
    }
  }
}
settings.onChange(() => void syncAdapters());
await syncAdapters();

const port = Number(env.PORT || 3000);
const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, "");
const app = createServer({
  brain,
  settings,
  store,
  flatkey,
  adapters: () => running,
  configured: {
    discord: Boolean(factories.discord),
    telegram: Boolean(factories.telegram),
    slack: Boolean(factories.slack),
    web: true,
  },
  adminToken: env.ADMIN_TOKEN || "change-me",
  publicUrl,
  publicDir: path.join(root, "public"),
});
const server = app.listen(port, () => {
  console.log(`[mochi] dashboard: ${publicUrl}/dashboard/`);
  console.log(`[mochi] web widget: <script src="${publicUrl}/widget/widget.js" data-server="${publicUrl}" defer></script>`);
});

async function shutdown() {
  console.log("[mochi] shutting down…");
  server.close();
  await Promise.allSettled(Object.values(running).map((a) => a.stop()));
  store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
