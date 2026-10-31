import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Brain } from "./core/brain.ts";
import { BotRegistry } from "./core/bots.ts";
import { SecretsStore } from "./core/secrets.ts";
import { FlatkeyClient } from "./flatkey/client.ts";
import { resolveFlatkeyBaseUrl, whyFlatkeyBanner } from "./flatkey/why.ts";
import { MemoryStore } from "./memory/store.ts";
import { MemoryUpdater } from "./memory/updater.ts";
import { KnowledgeStore } from "./knowledge/store.ts";
import { SearchAbility } from "./abilities/search.ts";
import { ChannelManager } from "./channels/manager.ts";
import { createServer } from "./server/app.ts";
import { takeEnvSecrets } from "./core/env-secrets.ts";
import { configureProxy, redactedProxy } from "./core/proxy.ts";

const env = { ...process.env };

// Node ignores the OS proxy settings. If HTTPS_PROXY / HTTP_PROXY is set, route outbound HTTP through it.
const proxy = configureProxy(env);
if (proxy) console.log(`[mochi] outbound HTTP via proxy ${redactedProxy(proxy)}`);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Provider keys that came in through the environment are remembered for redaction and then
// removed from process.env, so they stop being inherited by child processes and dumps.
const envSecretsFound = takeEnvSecrets();
if (envSecretsFound.length)
  console.warn(
    `[mochi] read ${envSecretsFound.join(", ")} from the environment and removed them from it. ` +
      `Prefer binding keys in the dashboard (data/secrets.json) so they aren't inherited by child processes.`,
  );

let flatkeyBaseUrl: string;
try {
  flatkeyBaseUrl = resolveFlatkeyBaseUrl(env.FLATKEY_BASE_URL);
} catch (err) {
  console.error(`[mochi] ${(err as Error).message}`);
  process.exit(1);
}
if (!env.ADMIN_TOKEN || env.ADMIN_TOKEN === "change-me") {
  console.warn("[mochi] ADMIN_TOKEN is not set or is the default. Set a strong one before exposing the dashboard.");
}

const dataDir = path.resolve(env.DATA_DIR || path.join(root, "data"));
fs.mkdirSync(dataDir, { recursive: true });

const bots = new BotRegistry(dataDir);
const secrets = new SecretsStore(dataDir);
const store = new MemoryStore(dataDir);
const knowledge = new KnowledgeStore(store.db);
// A key bound in the dashboard takes precedence over FLATKEY_API_KEY in .env.
const flatkey = new FlatkeyClient(secrets.flatkeyApiKey ?? env.FLATKEY_API_KEY, flatkeyBaseUrl);
const updater = new MemoryUpdater(flatkey, store, bots);
const search = new SearchAbility(flatkey);
const brain = new Brain({ flatkey, store, knowledge, updater, search, bots, secrets });

// Channel tokens are bound per bot in the dashboard. Tokens in .env still work for the first bot.
const channels = new ChannelManager(bots, secrets, brain, {
  env: {
    discord: env.DISCORD_BOT_TOKEN,
    telegram: env.TELEGRAM_BOT_TOKEN,
    slackBot: env.SLACK_BOT_TOKEN,
    slackApp: env.SLACK_APP_TOKEN,
    qqAppId: env.QQ_APP_ID,
    qqAppSecret: env.QQ_APP_SECRET,
  },
});
await channels.startAll();

// The channel manager needs the brain, so the history provider is wired right after both
// exist: search_history can then read older messages straight from the platform.
brain.setHistoryProvider({
  fetchHistory: (botId, platform, roomId, limit) =>
    platform === "web" ? Promise.resolve([]) : channels.fetchHistory(botId, platform, roomId, limit),
});

const port = Number(env.PORT || 3000);
const publicUrl = (env.PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, "");
const app = createServer({
  brain,
  bots,
  channels,
  secrets,
  envFlatkeyKey: env.FLATKEY_API_KEY,
  store,
  knowledge,
  flatkey,
  adminToken: env.ADMIN_TOKEN || "change-me",
  publicUrl,
  publicDir: path.join(root, "public"),
});
const server = app.listen(port, () => {
  if (!flatkey.hasKey()) {
    console.log(whyFlatkeyBanner());
    console.log(`  👉 Bind your key in the dashboard: ${publicUrl}/dashboard/#flatkey\n`);
  }
  console.log(`[mochi] ${bots.list().length} bot(s): ${bots.list().map((b) => `${b.persona.avatar} ${b.persona.name}`).join(", ")}`);
  console.log(`[mochi] dashboard: ${publicUrl}/dashboard/`);
});

async function shutdown() {
  console.log("[mochi] shutting down…");
  server.close();
  await channels.stopAll();
  store.close();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
