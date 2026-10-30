import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { makeStack } from "./helpers.ts";
import { ChannelManager } from "../src/channels/manager.ts";
import { createServer } from "../src/server/app.ts";
import type { PlatformAdapter } from "../src/core/types.ts";

let S: Awaited<ReturnType<typeof makeStack>>;
let base: string;
let close: () => void;
const started: string[] = [];
const platformCalls: string[] = [];
const H = { authorization: "Bearer admin-secret", "content-type": "application/json" };
const TG_OK = "123456789:AAvalid-telegram-token-xyz";

// Fake platform APIs: only TG_OK and the "good" Discord token are valid.
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  platformCalls.push(`${init?.method ?? "GET"} ${u.replace(TG_OK, "<tg>")}`);
  const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  if (u.includes(`bot${TG_OK}/getMe`)) return ok({ ok: true, result: { username: "helpdesk_bot" } });
  if (u === "https://bots.qq.com/app/getAppAccessToken") {
    const b = JSON.parse(String(init?.body ?? "{}"));
    return b.appId === "102012345" && b.clientSecret === "good-qq-secret"
      ? ok({ access_token: "qq-token", expires_in: "7200" })
      : new Response(JSON.stringify({ code: 100016, message: "invalid appid or secret" }), { status: 200 });
  }
  if (u === "https://api.sgroup.qq.com/users/@me") return ok({ id: "999", username: "MochiQQ" });
  if (u.includes("api.telegram.org")) return ok(u.includes("getMe") ? { ok: false } : { ok: true });
  const auth = String((init?.headers as any)?.authorization ?? "");
  if (u.endsWith("/users/@me")) return auth.startsWith("Bot good-discord-token") ? ok({ id: "111", username: "Helpdesk", discriminator: "0" }) : new Response("{}", { status: 401 });
  if (u.endsWith("/applications/@me")) return init?.method === "PATCH" ? ok({}) : ok({ id: "222", flags: auth.includes("nointent") ? 0 : 1 << 19 });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

before(async () => {
  S = await makeStack({ key: undefined }); // start with NO Flatkey key
  const channels = new ChannelManager(S.bots, S.secrets, S.brain, {
    http: fakeFetch,
    factory: (botId, p): PlatformAdapter => ({
      platform: p, botId,
      start: async () => void started.push(`${botId}:${p}`),
      stop: async () => void started.splice(started.indexOf(`${botId}:${p}`), 1),
      status: () => ({ running: started.includes(`${botId}:${p}`), detail: "fake" }),
    }),
  });
  const app = createServer({
    brain: S.brain, bots: S.bots, channels, secrets: S.secrets, store: S.store, knowledge: S.knowledge, flatkey: S.flatkey,
    adminToken: "admin-secret", publicUrl: "http://localhost", publicDir: path.join(import.meta.dirname, "..", "public"),
  });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(async () => {
  close();
  await S.close();
});

const j = async (p: string, init: { method?: string; body?: unknown } = {}) => {
  const r = await fetch(base + p, { method: init.method, headers: H, body: init.body ? JSON.stringify(init.body) : undefined });
  return { status: r.status, body: (await r.json()) as any };
};
const widget = (bot: string, text: string) =>
  fetch(`${base}/api/widget/${bot}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sessionId: "s1", text }) }).then((r) => r.json() as any);

test("admin API requires the token", async () => {
  assert.equal((await fetch(base + "/api/admin/overview")).status, 401);
});

test("starts unbound with the tracked create-key link, and bots ask for a key", async () => {
  const { body } = await j("/api/admin/overview");
  assert.equal(body.flatkey.bound, false);
  const u = new URL(body.flatkey.keysUrl);
  assert.equal(u.searchParams.get("utm_source"), "mochi_bot");
  assert.equal(u.searchParams.get("utm_medium"), "local_deploy");
  const n = S.mock.calls.length;
  assert.match((await widget("mochi", "hi")).reply, /bind a Flatkey API key/);
  assert.equal(S.mock.calls.length, n);
});

test("binds a Flatkey key: rejects bad ones, saves good ones 0600 and masked", async () => {
  const bad = await j("/api/admin/flatkey", { method: "PUT", body: { apiKey: "bad-key-1234567890" } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /rejected/);
  const key = "fk-live-abcdef1234567890";
  const ok = await j("/api/admin/flatkey", { method: "PUT", body: { apiKey: key } });
  assert.equal(ok.body.bound, true);
  assert.ok(!JSON.stringify(ok.body).includes(key));
  const file = path.join(S.dir, "secrets.json");
  // POSIX modes don't exist on Windows (NTFS reports 0666 whatever we chmod), so the
  // 0600 guarantee is only assertable where the platform implements it.
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.match((await widget("mochi", "hello there")).reply, /you said/);
});

test("model list comes from the Flatkey catalog, grouped by provider", async () => {
  const { body } = await j("/api/admin/models");
  const ids = body.models.map((m: any) => m.id);
  assert.ok(ids.includes("deepseek-v4-1-flash"));
  assert.equal(body.models.find((m: any) => m.id === "deepseek-v4-1-flash").provider, "DeepSeek");
  assert.equal(body.models.find((m: any) => m.id === "claude-haiku-5-5").provider, "Anthropic");
  // Defaults for new bots are in the catalog.
  const b = S.bots.get("mochi")!;
  for (const m of Object.values(b.models)) assert.ok(ids.includes(m), `${m} should be a Flatkey model`);
});

test("create a Q&A bot, edit its persona, preview the prompt", async () => {
  const { body } = await j("/api/admin/bots", { method: "POST", body: { preset: "qa", name: "Helpdesk" } });
  const id = body.bot.id;
  assert.equal(body.bot.mode, "qa");
  const up = await j(`/api/admin/bots/${id}`, { method: "PUT", body: { persona: { description: "Answers questions about Acme.", avatar: "🛟", tone: "calm" } } });
  assert.equal(up.body.bot.persona.description, "Answers questions about Acme.");
  assert.match(up.body.personaPrompt, /You are Helpdesk\. Answers questions about Acme\./);
  const prev = await j(`/api/admin/bots/${id}/persona-preview`, { method: "POST", body: { persona: { name: "Draft name" } } });
  assert.match(prev.body.prompt, /^You are Draft name\./);
  assert.equal(S.bots.get(id)!.persona.name, "Helpdesk", "preview doesn't save");
  const cfg = await fetch(`${base}/api/widget/${id}/config`).then((r) => r.json() as any);
  assert.deepEqual([cfg.name, cfg.avatar, cfg.description], ["Helpdesk", "🛟", "Answers questions about Acme."]);
  const ov = await j("/api/admin/overview");
  assert.equal(ov.body.bots.length, 2);
});

test("knowledge base: add text, file and test retrieval; the bot answers from it", async () => {
  const id = S.bots.list()[1].id;
  const t = await j(`/api/admin/bots/${id}/knowledge/text`, { method: "POST", body: { title: "Shipping", text: "We ship worldwide. Orders ship within 2 business days." } });
  assert.equal(t.body.doc.title, "Shipping");
  const md = Buffer.from("# Warranty\n\nAll Acme products carry a 2-year warranty covering manufacturing defects.").toString("base64");
  const f = await j(`/api/admin/bots/${id}/knowledge/file`, { method: "POST", body: { filename: "warranty.md", data: md } });
  assert.equal(f.body.doc.source, "file");
  const badType = await j(`/api/admin/bots/${id}/knowledge/file`, { method: "POST", body: { filename: "x.exe", data: md } });
  assert.match(badType.body.error, /Unsupported file type/);
  const local = await j(`/api/admin/bots/${id}/knowledge/url`, { method: "POST", body: { url: "http://127.0.0.1:1/secret" } });
  assert.match(local.body.error, /Private or local/);

  const test = await j(`/api/admin/bots/${id}/knowledge/test`, { method: "POST", body: { question: "how long is the warranty?" } });
  assert.equal(test.body.hits[0].title, "warranty");
  assert.match((await widget(id, "How long is the warranty?")).reply, /2-year warranty/);

  const docs = (await j(`/api/admin/bots/${id}/knowledge`)).body.docs;
  assert.equal(docs.length, 2);
  await j(`/api/admin/bots/${id}/knowledge/${docs[0].id}`, { method: "DELETE" });
  assert.equal((await j(`/api/admin/bots/${id}/knowledge`)).body.docs.length, 1);
});

test("channels: verify tokens before saving, start the bot, sync description", async () => {
  const id = S.bots.list()[1].id;
  const bad = await j(`/api/admin/bots/${id}/channels/telegram`, { method: "PUT", body: { token: "123456789:AAwrong-telegram-token-xyz" } });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Telegram rejected this token/);
  const shape = await j(`/api/admin/bots/${id}/channels/telegram`, { method: "PUT", body: { token: "nope" } });
  assert.match(shape.body.error, /looks like 123456789/);

  const ok = await j(`/api/admin/bots/${id}/channels/telegram`, { method: "PUT", body: { token: TG_OK } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.channel.identity.account, "@helpdesk_bot");
  assert.equal(ok.body.channel.identity.link, "https://t.me/helpdesk_bot");
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(started.includes(`${id}:telegram`), "adapter started");
  assert.ok(platformCalls.some((c) => c.includes("setMyDescription")), "description synced to Telegram");
  assert.ok(!JSON.stringify(ok.body).includes(TG_OK), "token never returned");

  // Same token can't serve two bots.
  const dup = await j(`/api/admin/bots/mochi/channels/telegram`, { method: "PUT", body: { token: TG_OK } });
  assert.match(dup.body.error, /already connected to "Helpdesk"/);

  // Discord: needs the Message Content intent.
  const noIntent = await j(`/api/admin/bots/mochi/channels/discord`, { method: "PUT", body: { token: "good-discord-token-nointent-aaaaaa" } });
  assert.match(noIntent.body.error, /Message Content Intent/);
  const badDiscord = await j(`/api/admin/bots/mochi/channels/discord`, { method: "PUT", body: { token: "wrong-discord-token-aaaaaaaaaaaaaaa" } });
  assert.match(badDiscord.body.error, /Discord rejected this token/);
  const d = await j(`/api/admin/bots/mochi/channels/discord`, { method: "PUT", body: { token: "good-discord-token-aaaaaaaaaaaaaaaa" } });
  assert.equal(d.status, 200);
  assert.match(d.body.channel.identity.link, /client_id=222&scope=bot&permissions=68608/);

  // QQ: AppID + AppSecret verified through the official token endpoint.
  const qqShape = await j(`/api/admin/bots/mochi/channels/qq`, { method: "PUT", body: { appId: "abc", appSecret: "x" } });
  assert.match(qqShape.body.error, /AppID is a number/);
  const qqBad = await j(`/api/admin/bots/mochi/channels/qq`, { method: "PUT", body: { appId: "102012345", appSecret: "wrong-qq-secret" } });
  assert.match(qqBad.body.error, /QQ rejected this AppID/);
  const qq = await j(`/api/admin/bots/mochi/channels/qq`, { method: "PUT", body: { appId: "102012345", appSecret: "good-qq-secret" } });
  assert.equal(qq.status, 200);
  assert.match(qq.body.channel.identity.account, /^MochiQQ/);
  assert.ok(!JSON.stringify(qq.body).includes("good-qq-secret"), "secret never returned");
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(started.includes("mochi:qq"));
  const ov = await j("/api/admin/overview");
  assert.ok(ov.body.bots.find((b: any) => b.id === "mochi").channels.some((c: any) => c.platform === "qq" && c.running));

  // Changing the description re-syncs it.
  platformCalls.length = 0;
  await j(`/api/admin/bots/${id}`, { method: "PUT", body: { persona: { description: "New description" } } });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(platformCalls.some((c) => c.includes("setMyDescription")));

  // Pause → stops; resume → starts; disconnect → stops and forgets the token.
  await j(`/api/admin/bots/${id}`, { method: "PUT", body: { channels: { telegram: { enabled: false } } } });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!started.includes(`${id}:telegram`));
  await j(`/api/admin/bots/${id}`, { method: "PUT", body: { channels: { telegram: { enabled: true } } } });
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(started.includes(`${id}:telegram`));
  const un = await j(`/api/admin/bots/${id}/channels/telegram`, { method: "DELETE" });
  assert.equal(un.body.channel.bound, false);
  assert.ok(!started.includes(`${id}:telegram`));
  assert.equal(S.secrets.channels(id).telegram, undefined);
});

test("deleting a bot stops its channels and erases its data", async () => {
  const id = S.bots.list()[1].id;
  await j(`/api/admin/bots/${id}/channels/telegram`, { method: "PUT", body: { token: TG_OK } });
  await new Promise((r) => setTimeout(r, 50));
  const del = await j(`/api/admin/bots/${id}`, { method: "DELETE" });
  assert.equal(del.body.ok, true);
  assert.ok(!started.includes(`${id}:telegram`));
  assert.equal(S.knowledge.count(id), 0);
  assert.equal(S.secrets.channels(id).telegram, undefined);
  assert.equal((await j(`/api/admin/bots/${id}`)).status, 404);
  const last = await j(`/api/admin/bots/mochi`, { method: "DELETE" });
  assert.match(last.body.error, /at least one bot/);
});

test("usage can be filtered per bot", async () => {
  const all = await j("/api/admin/usage?days=1");
  const mochi = await j("/api/admin/usage?days=1&bot=mochi");
  assert.ok(all.body.rows.length >= 1);
  assert.ok(mochi.body.rows.every((r: any) => r.botId === "mochi"));
});
