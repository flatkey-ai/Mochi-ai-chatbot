import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocketServer } from "ws";
import { makeStack } from "./helpers.ts";
import { QQAdapter, qqSafeText } from "../src/adapters/qq.ts";

let S: Awaited<ReturnType<typeof makeStack>>;
let api: http.Server;
let wss: WebSocketServer;
let base: string;
const posts: { path: string; body: any; auth: string }[] = [];
const identifies: any[] = [];
let closeFirstWith4014 = true;

before(async () => {
  S = await makeStack();
  wss = new WebSocketServer({ port: 0 });
  const wsUrl = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
  wss.on("connection", (sock) => {
    sock.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 30000 } }));
    sock.on("message", (raw) => {
      const p = JSON.parse(String(raw));
      if (p.op !== 2) return;
      identifies.push(p.d);
      if (closeFirstWith4014) {
        closeFirstWith4014 = false;
        return sock.close(4014, "disallowed intents");
      }
      sock.send(JSON.stringify({ op: 0, s: 1, t: "READY", d: { session_id: "sess", user: { id: "999", username: "MochiQQ" } } }));
      setTimeout(() => {
        sock.send(JSON.stringify({ op: 0, s: 2, t: "GROUP_AT_MESSAGE_CREATE", d: { id: "msg-g1", group_openid: "G1", content: " hello from the group", author: { member_openid: "MEMBER0001" }, timestamp: new Date().toISOString() } }));
        sock.send(JSON.stringify({ op: 0, s: 3, t: "C2C_MESSAGE_CREATE", d: { id: "msg-c1", content: "hi in private", author: { user_openid: "USER0002" } } }));
        sock.send(JSON.stringify({ op: 0, s: 4, t: "GROUP_MESSAGE_CREATE", d: { id: "msg-g2", group_openid: "G1", content: "just chatting, not for the bot", author: { member_openid: "MEMBER0003" } } }));
      }, 20);
    });
  });
  api = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const send = (b: unknown) => (res.writeHead(200, { "content-type": "application/json" }), res.end(JSON.stringify(b)));
    if (req.url === "/token") return send({ access_token: "tok-1", expires_in: "7200" });
    if (req.url === "/users/@me") return send({ id: "999", username: "MochiQQ" });
    if (req.url === "/gateway") return send({ url: wsUrl });
    posts.push({ path: req.url ?? "", body: raw ? JSON.parse(raw) : null, auth: String(req.headers.authorization) });
    send({ id: "sent" });
  });
  await new Promise<void>((r) => api.listen(0, r));
  base = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
});
after(async () => {
  wss.close();
  api.close();
  await S.close();
});

test("QQ adapter: identifies, falls back on 4014, replies passively to group @ and private chats", async () => {
  const a = new QQAdapter("mochi", "102012345", "secret", S.brain, { tokenUrl: `${base}/token`, apiBase: base });
  await a.start();
  assert.equal(a.status().running, true);
  assert.match(a.status().detail, /MochiQQ/);

  // First identify asked for everything; QQ refused (4014) → retried with groups + private chats only.
  assert.equal(identifies.length, 2);
  assert.equal(identifies[0].token, "QQBot tok-1");
  assert.notEqual(identifies[0].intents, 1 << 25);
  assert.equal(identifies[1].intents, 1 << 25);

  for (let i = 0; i < 50 && posts.length < 2; i++) await new Promise((r) => setTimeout(r, 20));
  const group = posts.find((p) => p.path === "/v2/groups/G1/messages")!;
  assert.ok(group, "replied in the group");
  assert.equal(group.body.msg_id, "msg-g1", "passive reply quotes the msg_id");
  assert.equal(group.body.msg_seq, 1);
  assert.match(group.body.content, /hello from the group/);
  assert.equal(group.auth, "QQBot tok-1");
  const c2c = posts.find((p) => p.path === "/v2/users/USER0002/messages")!;
  assert.equal(c2c.body.msg_id, "msg-c1");
  assert.ok(!posts.some((p) => p.body?.msg_id === "msg-g2"), "doesn't reply to un-addressed group chatter");

  // Memory still recorded the un-addressed message, under the QQ platform.
  const room = S.store.recentMessages("mochi", "qq", "group:G1", 10);
  assert.ok(room.some((m) => m.text === "just chatting, not for the bot"));
  assert.ok(S.store.getPerson("mochi", "qq", "MEMBER0001")!.displayName.startsWith("QQ user"));

  await a.stop();
  assert.equal(a.status().running, false);
});

test("QQ replies never contain raw URLs (QQ blocks unregistered domains)", () => {
  const out = qqSafeText("The sky is blue.\n\n🔗 https://example.com/answer\nsee https://docs.flatkey.ai/x for more");
  assert.doesNotMatch(out, /https?:\/\//);
  assert.match(out, /docs\[\.\]flatkey\[\.\]ai/);
  assert.doesNotMatch(out, /example/);
});
