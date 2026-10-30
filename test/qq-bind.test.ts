import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { makeStack } from "./helpers.ts";
import { ChannelManager } from "../src/channels/manager.ts";
import { createServer } from "../src/server/app.ts";
import type { PlatformAdapter } from "../src/core/types.ts";

/**
 * Binding the QQ channel used to report every failure as "QQ rejected this AppID / AppSecret",
 * including plain network/TLS failures — so a server that couldn't reach QQ looked like a
 * credentials problem. These tests pin down which failure gets which message, and that the
 * verify step honours QQ_TOKEN_URL / QQ_API_BASE like the adapter does.
 */

let S: Awaited<ReturnType<typeof makeStack>>;
let base: string;
let close: () => void;
const calls: string[] = [];
const H = { authorization: "Bearer admin-secret", "content-type": "application/json" };

const TOKEN_URL = "http://qq.test/token";
const API_BASE = "http://qq.test/api";

const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  calls.push(u);
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  if (u === TOKEN_URL) {
    const b = JSON.parse(String(init?.body ?? "{}"));
    if (b.appId === "900000001") throw new TypeError("fetch failed"); // unreachable host
    if (b.appId === "900000002") return json({ code: 100016, message: "invalid appid or secret" }); // real rejection
    return json({ access_token: "qq-access-token", expires_in: "7200" });
  }
  if (u === `${API_BASE}/users/@me`) return json({ id: "1", username: "MochiQQ" });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

before(async () => {
  S = await makeStack();
  const channels = new ChannelManager(S.bots, S.secrets, S.brain, {
    http: fakeFetch,
    factory: (botId, p): PlatformAdapter => ({
      platform: p,
      botId,
      start: async () => {},
      stop: async () => {},
      status: () => ({ running: true, detail: "fake" }),
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

  process.env.QQ_TOKEN_URL = TOKEN_URL;
  process.env.QQ_API_BASE = API_BASE;
});

after(async () => {
  delete process.env.QQ_TOKEN_URL;
  delete process.env.QQ_API_BASE;
  close();
  await S.close();
});

const bind = async (appId: string, appSecret: string) => {
  const r = await fetch(`${base}/api/admin/bots/mochi/channels/qq`, {
    method: "PUT",
    headers: H,
    body: JSON.stringify({ appId, appSecret }),
  });
  return { status: r.status, body: (await r.json()) as any };
};

test("a network failure is reported as a network failure, not as a wrong AppSecret", async () => {
  const r = await bind("900000001", "any-secret-value");
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Couldn't reach QQ from this server/);
  assert.match(r.body.error, /not a wrong AppID/);
  assert.doesNotMatch(r.body.error, /QQ rejected this AppID/);
});

test("QQ rejecting the pair keeps the credential message", async () => {
  const r = await bind("900000002", "any-secret-value");
  assert.equal(r.status, 400);
  assert.match(r.body.error, /QQ rejected this AppID \/ AppSecret/);
  assert.doesNotMatch(r.body.error, /Couldn't reach QQ/);
});

test("the verify step honours QQ_TOKEN_URL and QQ_API_BASE, like the adapter does", async () => {
  calls.length = 0;
  const r = await bind("900000003", "good-secret-value");
  assert.equal(r.status, 200);
  assert.equal(r.body.channel.bound, true);
  assert.equal(r.body.channel.identity.account, "MochiQQ (AppID 900000003)");
  assert.ok(calls.includes(TOKEN_URL), `token url not used: ${calls.join(", ")}`);
  assert.ok(calls.includes(`${API_BASE}/users/@me`), `api base not used: ${calls.join(", ")}`);
  assert.ok(!calls.some((u) => u.includes("bots.qq.com")), "verify must not fall back to the hardcoded host when overridden");
});
