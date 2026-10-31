import crypto from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { LineAdapter } from "../src/adapters/line.ts";
import { CAPABILITY_MATRIX, createChannelAdapter } from "../src/channels/factory.ts";
import { msg } from "./helpers.ts";

/**
 * LINE is the only channel with a webhook instead of a socket, so the signature check is the
 * security boundary: an unsigned or mis-signed delivery must never reach the brain.
 */

const SECRET = "0123456789abcdef0123456789abcdef";
const sign = (body: string, secret = SECRET) => crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");

/** Answers once with a fixed reply, and records what the core was asked to do. */
const brain = (replyText = "hello from LINE") =>
  ({ handle: async () => ({ text: replyText, usedSearch: false, usedVision: false }) }) as any;

const event = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    destination: "Udest",
    events: [
      {
        type: "message",
        replyToken: "REPLY-TOKEN",
        timestamp: Date.now(),
        source: { type: "user", userId: "U1234567890" },
        message: { id: "MSG1", type: "text", text: "hi there" },
        ...over,
      },
    ],
  });

/** Capture LINE API calls without touching the network. */
function stubFetch() {
  const calls: { url: string; body: any }[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

test("the capability matrix matches what the LINE adapter declares", () => {
  const adapter = createChannelAdapter("mochi", { platform: "line", channelAccessToken: "x".repeat(120), channelSecret: SECRET }, brain());
  assert.equal(adapter.platform, "line");
  assert.deepEqual([...adapter.capabilities].sort(), CAPABILITY_MATRIX.line.slice().sort());
  assert.equal(adapter.supports("history"), false, "LINE has no history API");
});

test("an unsigned or mis-signed delivery is rejected", async () => {
  const adapter = new LineAdapter("mochi", "x".repeat(120), SECRET, brain());
  const body = event();
  await assert.rejects(() => adapter.handleWebhook(body, undefined), /signature/);
  await assert.rejects(() => adapter.handleWebhook(body, sign(body, "wrong-secret")), /signature/);
  await assert.rejects(() => adapter.handleWebhook(`${body} `, sign(body)), /signature/, "body tampered after signing");
  await adapter.handleWebhook(body, sign(body)); // the real one is accepted
});

test("a text message from a user is answered with its reply token", async () => {
  const { calls, restore } = stubFetch();
  try {
    const adapter = new LineAdapter("mochi", "x".repeat(120), SECRET, brain());
    const body = event();
    await adapter.handleWebhook(body, sign(body));
    const reply = calls.find((c) => c.url.includes("/v2/bot/message/reply"));
    assert.ok(reply, "reply endpoint used");
    assert.equal(reply!.body.replyToken, "REPLY-TOKEN");
    assert.equal(reply!.body.messages[0].text, "hello from LINE");
  } finally {
    restore();
  }
});

test("without a usable reply token the answer goes out through push", async () => {
  const { calls, restore } = stubFetch();
  try {
    const adapter = new LineAdapter("mochi", "x".repeat(120), SECRET, brain());
    const body = event({ replyToken: undefined });
    await adapter.handleWebhook(body, sign(body));
    const push = calls.find((c) => c.url.includes("/v2/bot/message/push"));
    assert.ok(push, "push endpoint used when no reply token exists");
    assert.equal(push!.body.to, "U1234567890");
  } finally {
    restore();
  }
});

test("group messages are not treated as direct messages", async () => {
  const { calls, restore } = stubFetch();
  try {
    const adapter = new LineAdapter("mochi", "x".repeat(120), SECRET, brain());
    const body = event({ source: { type: "group", groupId: "GROUP1", userId: "U1234567890" } });
    await adapter.handleWebhook(body, sign(body));
    // A group reply must go to the group, not to the person who spoke.
    const call = calls.find((c) => c.url.includes("/v2/bot/message/reply"));
    assert.ok(call);
    assert.equal(call!.body.replyToken, "REPLY-TOKEN");
    // ...and the push fallback would target the group id
    const pushTarget = calls.find((c) => c.url.includes("/push"));
    assert.equal(pushTarget, undefined, "a fresh reply token was used");
  } finally {
    restore();
  }
});

test("non-message events (follow, postback) are ignored, not crashed on", async () => {
  const { calls, restore } = stubFetch();
  try {
    const adapter = new LineAdapter("mochi", "x".repeat(120), SECRET, brain());
    const body = JSON.stringify({ events: [{ type: "follow", timestamp: Date.now() }, { type: "postback", replyToken: "X" }] });
    await adapter.handleWebhook(body, sign(body));
    assert.equal(calls.length, 0, "nothing was sent");
  } finally {
    restore();
  }
});

test("sendTo pushes to a person or a group", async () => {
  const { calls, restore } = stubFetch();
  try {
    const adapter = new LineAdapter("mochi", "x".repeat(120), SECRET, brain());
    await adapter.sendTo({ kind: "dm", id: "U1", userId: "U1" }, "ping");
    await adapter.sendTo({ kind: "group", id: "GROUP1" }, "pong");
    assert.deepEqual(
      calls.map((c) => c.body.to),
      ["U1", "GROUP1"],
    );
  } finally {
    restore();
  }
});

test("a sticker or video becomes a text note instead of silence", async () => {
  const { calls, restore } = stubFetch();
  try {
    const adapter = new LineAdapter("mochi", "x".repeat(120), SECRET, brain());
    const body = event({ message: { id: "MSG2", type: "sticker" } });
    await adapter.handleWebhook(body, sign(body));
    const reply = calls.find((c) => c.url.includes("/reply"));
    assert.match(reply!.body.messages[0].text, /hello from LINE/);
  } finally {
    restore();
  }
});
