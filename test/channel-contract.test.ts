import { test } from "node:test";
import assert from "node:assert/strict";
import { ChannelAdapter, UnsupportedCapability, type ChannelCapability, type ChatTarget } from "../src/core/channel.ts";
import { CAPABILITY_MATRIX, CHAT_PLATFORMS, createChannelAdapter, isChatPlatform, type AdapterCredentials } from "../src/channels/factory.ts";
import { ChannelManager, roomTarget } from "../src/channels/manager.ts";
import { makeStack, FakeAdapter, msg } from "./helpers.ts";
import type { Platform } from "../src/core/types.ts";

/**
 * One channel contract, one factory. These tests are what keeps the channels honest:
 * capabilities are declared, the factory builds the right adapter, and asking for something
 * a platform cannot do fails loudly instead of silently returning nothing.
 */

test("a channel that does not declare a capability refuses it", async () => {
  class Minimal extends ChannelAdapter {
    readonly platform = "qq" as const;
    readonly capabilities: ReadonlySet<ChannelCapability> = new Set<ChannelCapability>(["reply"]);
    async start() {}
    async stop() {}
    status() {
      return { running: true };
    }
    async replyTo() {}
    async sendTo() {
      this.require("send");
    }
  }
  const adapter = new Minimal("mochi");
  assert.equal(adapter.supports("reply"), true);
  assert.equal(adapter.supports("send"), false);
  await assert.rejects(() => adapter.sendTo(), (err: unknown) => {
    assert.ok(err instanceof UnsupportedCapability);
    assert.equal(err.capability, "send");
    assert.equal(err.platform, "qq");
    return true;
  });
  await assert.rejects(() => adapter.fetchHistory({ kind: "group", id: "1" }, 5), UnsupportedCapability);
  assert.deepEqual(adapter.describe(), { platform: "qq", capabilities: ["reply"] });
});

test("the factory builds the right adapter for every chat platform", () => {
  const brain = {} as any; // constructors only store it
  const cases: AdapterCredentials[] = [
    { platform: "discord", token: "x" },
    { platform: "telegram", token: "1:abc" },
    { platform: "slack", botToken: "xoxb-1", appToken: "xapp-1" },
    { platform: "qq", appId: "102012345", appSecret: "secret1234" },
    { platform: "line", channelAccessToken: "x".repeat(120), channelSecret: "0123456789abcdef0123456789abcdef" },
  ];
  for (const creds of cases) {
    const adapter = createChannelAdapter("mochi", creds, brain);
    assert.equal(adapter.platform, creds.platform);
    assert.equal(adapter.botId, "mochi");
    assert.ok([...adapter.capabilities].length > 0, `${creds.platform} declares no capabilities`);
    // The published matrix must not drift from what the adapter actually declares.
    assert.deepEqual([...adapter.capabilities].sort(), CAPABILITY_MATRIX[creds.platform as keyof typeof CAPABILITY_MATRIX].slice().sort());
  }
  assert.equal(isChatPlatform("web"), false);
  assert.equal(isChatPlatform("discord"), true);
  assert.deepEqual(CHAT_PLATFORMS.sort(), ["discord", "line", "qq", "slack", "telegram"]);
});

test("history is only promised where the platform can actually deliver it", async () => {
  const brain = {} as any;
  const qq = createChannelAdapter("mochi", { platform: "qq", appId: "102012345", appSecret: "secret1234" }, brain);
  const tg = createChannelAdapter("mochi", { platform: "telegram", token: "1:abc" }, brain);
  const discord = createChannelAdapter("mochi", { platform: "discord", token: "x" }, brain);
  assert.equal(qq.supports("history"), false, "QQ has no history API");
  assert.equal(tg.supports("history"), false, "Telegram Bot API has no history API");
  assert.equal(discord.supports("history"), true);
  await assert.rejects(() => qq.fetchHistory({ kind: "group", id: "g1" }, 10), UnsupportedCapability);
});

test("room ids carry the target kind, and the manager degrades quietly", async () => {
  assert.deepEqual(roomTarget("group:ABC"), { kind: "group", id: "ABC", userId: undefined });
  assert.deepEqual(roomTarget("c2c:U1"), { kind: "dm", id: "U1", userId: "U1" });
  assert.deepEqual(roomTarget("plain"), { kind: "group", id: "plain", userId: undefined });

  const S = await makeStack();
  try {
    // No adapter running yet: history is simply empty, not an error.
    const manager = new ChannelManager(S.bots, S.secrets, S.brain, {});
    assert.deepEqual(await manager.fetchHistory("mochi", "discord", "group:1", 10), []);
  } finally {
    await S.close();
  }
});

test("search_history falls back to the platform API when the database is thin", async () => {
  const S = await makeStack();
  try {
    // Nothing local for this room, but the platform can backfill: the model should see it.
    S.brain.setHistoryProvider({
      fetchHistory: async () => [{ userId: "u1", userName: "Blood", text: "the deploy runs on E:\\qqbot", ts: Date.now() - 120_000 }],
    });
    const reply = await S.brain.handle(
      msg({ platform: "discord", roomId: "room-remote", text: "what were we talking about earlier?", isDirect: true, mentionsBot: true }),
    );
    assert.ok(reply, "replied");
    const historyTurns = S.mock.calls
      .flatMap((c) => c.body?.messages ?? [])
      .filter((m: any) => m.role === "tool" && String(m.content).includes("the deploy runs on"));
    assert.ok(historyTurns.length > 0, "platform history reached the model");
  } finally {
    await S.close();
  }
});

test("a FakeAdapter records what the core asked for", async () => {
  const adapter = new FakeAdapter("mochi", "slack");
  await adapter.start();
  assert.equal(adapter.status().running, true);
  const target: ChatTarget = { kind: "dm", id: "U1", userId: "U1" };
  await adapter.sendTo(target, "hi there");
  await adapter.replyTo(msg({ platform: "slack" as Platform }), "reply text");
  assert.deepEqual(adapter.sent, [{ target, text: "hi there" }]);
  assert.equal(adapter.replies.length, 1);
  assert.equal(adapter.replies[0].text, "reply text");
});
