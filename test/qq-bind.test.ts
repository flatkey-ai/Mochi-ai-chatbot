import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { makeStack, FakeAdapter } from "./helpers.ts";
import { ChannelManager } from "../src/channels/manager.ts";
import { createServer } from "../src/server/app.ts";
import type { PlatformAdapter } from "../src/core/types.ts";

/**
 * Binding the QQ channel used to report every failure as "QQ rejected this AppID / AppSecret",
 * including plain network/TLS failures — so a server that couldn't reach QQ looked like a
 * credentials problem. These tests pin down which failure gets which message, and that the
 * AppSecret only ever goes to QQ's own endpoints (the dashboard binding is the single source
 * of truth, nothing in the environment can redirect it).
 */

let S: Awaited<ReturnType<typeof makeStack>>;
let base: string;
let close: () => void;
const calls: string[] = [];
const H = { authorization: "Bearer admin-secret", "content-type": "application/json" };

const TOKEN_URL = "https://bots.qq.com/app/getAppAccessToken";
const ME_URL = "https://api.sgroup.qq.com/users/@me";

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
  if (u === ME_URL) return json({ id: "1", username: "MochiQQ" });
  return new Response("{}", { status: 404 });
}) as typeof fetch;

before(async () => {
  S = await makeStack();
  const channels = new ChannelManager(S.bots, S.secrets, S.brain, {
    http: fakeFetch,
        factory: (botId, p): PlatformAdapter => new FakeAdapter(botId, p),
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

test("the AppSecret only goes to QQ's own endpoints, whatever the environment says", async () => {
  const saved = { token: process.env.QQ_TOKEN_URL, api: process.env.QQ_API_BASE };
  process.env.QQ_TOKEN_URL = "https://collector.example/steal";
  process.env.QQ_API_BASE = "https://collector.example/api";
  try {
    calls.length = 0;
    const r = await bind("900000003", "good-secret-value");
    assert.equal(r.status, 200);
    assert.equal(r.body.channel.bound, true);
    assert.equal(r.body.channel.identity.account, "MochiQQ (AppID 900000003)");
    assert.deepEqual(calls, [TOKEN_URL, ME_URL], `unexpected hosts: ${calls.join(", ")}`);
    assert.ok(!calls.some((u) => u.includes("collector.example")), "an env var must not be able to redirect the credentials");
  } finally {
    if (saved.token === undefined) delete process.env.QQ_TOKEN_URL; else process.env.QQ_TOKEN_URL = saved.token;
    if (saved.api === undefined) delete process.env.QQ_API_BASE; else process.env.QQ_API_BASE = saved.api;
  }
});
