import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStack, msg } from "./helpers.ts";

/**
 * "What were we talking about before I @'d you?" needs two things:
 *   1. the room actually stored those messages (platform-dependent — see DEPLOY-QQ.md), and
 *   2. a way to look past the window that fits in the prompt.
 * (2) is search_history, tested here.
 */

test("older messages stay searchable per room, beyond the prompt window", async () => {
  const S = await makeStack();
  try {
    const store = S.store;
    for (const [i, text] of ["we're planning the refund flow", "and the pricing page", "lunch?"].entries())
      store.addMessage({ botId: "mochi", platform: "qq", roomId: "group:abc", userId: "u1", userName: "Blood", text, hasImage: false, isBot: false, ts: Date.now() + i });
    store.addMessage({ botId: "mochi", platform: "qq", roomId: "group:other", userId: "u2", userName: "Other", text: "refund flow elsewhere", hasImage: false, isBot: false, ts: Date.now() });

    const hits = store.searchMessages("mochi", "qq", "group:abc", "refund", 5);
    assert.equal(hits.length, 1, "keyword search is scoped to this room");
    assert.match(hits[0].text, /refund flow/);

    const recent = store.searchMessages("mochi", "qq", "group:abc", "", 2);
    assert.equal(recent.length, 2, "empty query returns the most recent older messages");
    assert.match(recent[1].text, /lunch/);

    assert.equal(store.countMessages("mochi", "qq", "group:abc"), 3, "room message count is available");
  } finally {
    await S.close();
  }
});

test("the bot reaches for search_history instead of guessing", async () => {
  const S = await makeStack();
  try {
    // Seed older context that is not in the prompt window: the limit is 20 messages.
    for (let i = 0; i < 8; i++)
      S.store.addMessage({
        botId: "mochi", platform: "qq", roomId: "room1", userId: "u1", userName: "Blood",
        text: i === 2 ? "by the way the deploy runs on E:\\qqbot" : `filler ${i}`,
        hasImage: false, isBot: false, ts: Date.now() - 60_000 + i,
      });

    const r = await S.brain.handle(
      msg({ platform: "qq", roomId: "room1", text: "what were we talking about earlier?", isDirect: true, mentionsBot: true }),
    );
    assert.ok(r, "replied");
    assert.match(r!.text, /From history:/, "answer came from the history tool, not thin air");

    const toolCall = S.mock.calls
      .flatMap((c) => c.body?.messages ?? [])
      .find((m: any) => m.tool_calls?.some((t: any) => t.function?.name === "search_history"));
    assert.ok(toolCall, "model was offered and used search_history");
  } finally {
    await S.close();
  }
});

test("search_history is scoped to one bot and one room", async () => {
  const S = await makeStack();
  try {
    S.store.addMessage({ botId: "mochi", platform: "qq", roomId: "room1", userId: "u1", userName: "A", text: "secret alpha", hasImage: false, isBot: false, ts: Date.now() });
    S.store.addMessage({ botId: "mochi", platform: "qq", roomId: "room2", userId: "u1", userName: "A", text: "secret beta", hasImage: false, isBot: false, ts: Date.now() });
    const room1 = S.store.searchMessages("mochi", "qq", "room1", "secret", 10);
    assert.deepEqual(room1.map((m) => m.text), ["secret alpha"]);
    assert.equal(S.store.searchMessages("mochi", "telegram", "room1", "secret", 10).length, 0, "platform is part of the scope");
  } finally {
    await S.close();
  }
});
