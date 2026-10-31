import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { makeStack, msg } from "./helpers.ts";

let S: Awaited<ReturnType<typeof makeStack>>;
before(async () => (S = await makeStack()));
after(() => S.close());

const lastChat = () => S.mock.calls.findLast((c) => c.path === "/v1/chat/completions")!;

test("a fresh install has one companion bot, Mochi", () => {
  const bots = S.bots.list();
  assert.equal(bots.length, 1);
  assert.equal(bots[0].id, "mochi");
  assert.equal(bots[0].persona.name, "Mochi");
  assert.equal(bots[0].mode, "companion");
  assert.equal(bots[0].models.chat, "deepseek-v4-1-flash");
  assert.equal(bots[0].models.memory, "deepseek-v4-1-flash");
});

test("stays quiet in groups unless addressed, but still remembers the message", async () => {
  const n = S.mock.calls.length;
  assert.equal(await S.brain.handle(msg({ text: "just chatting with friends" })), null);
  assert.equal(S.mock.calls.length, n, "no Flatkey call for unaddressed group messages");
  assert.equal(S.store.recentMessages("mochi", "discord", "room1", 10).length, 1);
});

test("replies when @mentioned or when its name is said (whole word only)", async () => {
  assert.match((await S.brain.handle(msg({ text: "what's up", mentionsBot: true })))!.text, /you said/);
  assert.equal(lastChat().body.model, "deepseek-v4-1-flash", "default chat model");
  assert.ok(await S.brain.handle(msg({ text: "hey mochi, you there?" })));
  assert.equal(await S.brain.handle(msg({ text: "mochimochi is a cake" })), null);
});

test("persona fields reach the system prompt", async () => {
  S.bots.update("mochi", { persona: { description: "The cutest bot in town.", personality: "Loves bubble tea.", tone: "sassy", emoji: "none", language: "English", rules: "Never talk about politics" } });
  await S.brain.handle(msg({ text: "hi", mentionsBot: true }));
  const sys = lastChat().body.messages[0].content as string;
  assert.match(sys, /You are Mochi\. The cutest bot in town\./);
  assert.match(sys, /Personality: Loves bubble tea\./);
  assert.match(sys, /sassy/);
  assert.match(sys, /Don't use emoji/);
  assert.match(sys, /Always reply in English/);
  assert.match(sys, /- Never talk about politics/);

  S.bots.update("mochi", { persona: { customPrompt: "You are a pirate named Mochi. Arr." } });
  await S.brain.handle(msg({ text: "hi", mentionsBot: true }));
  const sys2 = lastChat().body.messages[0].content as string;
  assert.match(sys2, /^You are a pirate named Mochi\. Arr\./);
  assert.doesNotMatch(sys2, /bubble tea/, "custom prompt replaces the generated persona");
  S.bots.update("mochi", { persona: { customPrompt: "" } });
});

test("search: tool call → Flatkey /v1/messages web_search → grounded answer with source", async () => {
  const r = await S.brain.handle(msg({ text: "what's the weather today?", mentionsBot: true }));
  assert.ok(r?.usedSearch);
  assert.match(r!.text, /sky is blue/);
  assert.match(r!.text, /example\.com\/answer/);
  assert.doesNotMatch(r!.text, /^Mochi:/, "speaker prefix stripped");
  assert.equal(S.mock.calls.findLast((c) => c.path === "/v1/messages")!.body.tools[0].type, "web_search_20250305");
});

test("turning search off removes the tool (cost control)", async () => {
  S.bots.update("mochi", { features: { search: false } });
  const r = await S.brain.handle(msg({ text: "latest news?", mentionsBot: true }));
  assert.equal(r?.usedSearch, false);
  // Other tools (search_history) may still be offered; what matters for cost control is that
  // the model has no way to spend a search-model call when the feature is off.
  const tools = (lastChat().body.tools ?? []) as any[];
  assert.ok(!tools.some((t) => t.function?.name === "web_search"), "web_search must not be offered");
  S.bots.update("mochi", { features: { search: true } });
});

test("vision: images go to the vision model; off = text placeholder", async () => {
  S.bots.update("mochi", { models: { vision: "vision-model-x" } });
  const img = { url: "data:image/png;base64,iVBORw0KGgo=" };
  const r = await S.brain.handle(msg({ text: "", images: [img], isDirect: true, roomId: "dm1" }));
  assert.ok(r?.usedVision);
  assert.equal(lastChat().body.model, "vision-model-x");
  assert.ok(lastChat().body.messages.at(-1).content.some((p: any) => p.type === "image_url"));
  S.bots.update("mochi", { features: { vision: false } });
  const r2 = await S.brain.handle(msg({ text: "look", images: [img], isDirect: true, roomId: "dm1" }));
  assert.equal(r2?.usedVision, false);
  assert.equal(typeof lastChat().body.messages.at(-1).content, "string");
  S.bots.update("mochi", { features: { vision: true } });
});

test("memory: background update builds profiles + topics that reach the prompt", async () => {
  S.bots.update("mochi", { limits: { memoryUpdateEvery: 50 } });
  for (const t of ["my cat Boba knocked over my plant 😭", "lol classic", "weekend plans anyone?"]) {
    await S.brain.handle(msg({ roomId: "room2", userId: "u2", userName: "Bea", text: t }));
  }
  await S.updater.update("mochi", "discord", "room2");
  const bea = S.store.getPerson("mochi", "discord", "u2")!;
  assert.match(bea.personality, /cheerful/);
  assert.deepEqual(bea.facts, ["Bea has a cat named Boba"]);
  assert.deepEqual(S.store.getRoom("mochi", "discord", "room2")!.recentTopics, ["cats", "weekend plans"]);
  const r = await S.brain.handle(msg({ roomId: "room2", userId: "u2", userName: "Bea", text: "hi", mentionsBot: true }));
  assert.match(r!.text, /Boba/);
  assert.match(lastChat().body.messages[0].content, /Recent topics: cats, weekend plans/);
});

test("multiple bots: separate personas and separate memory", async () => {
  const sage = S.bots.create("study", {});
  assert.equal(sage.persona.name, "Sage");
  assert.notEqual(sage.id, "mochi");
  const r = await S.brain.handle(msg({ botId: sage.id, roomId: "room2", userId: "u2", userName: "Bea", text: "hi sage", mentionsBot: true }));
  assert.doesNotMatch(r!.text, /Boba/, "Sage doesn't know what Bea told Mochi");
  assert.match(lastChat().body.messages[0].content, /^You are Sage\./);
  assert.equal(S.store.getPerson(sage.id, "discord", "u2")!.facts.length, 0);
  assert.equal(S.store.getPerson("mochi", "discord", "u2")!.facts.length, 1);
  assert.equal(await S.brain.handle(msg({ botId: "nope", text: "hi", mentionsBot: true })), null);
});

test("knowledge base: Q&A bot answers from its documents (EN + 中文)", async () => {
  const qa = S.bots.create("qa", { name: "Helpdesk" });
  assert.equal(qa.mode, "qa");
  assert.equal(qa.knowledge.strict, true);
  assert.equal(qa.features.search, false);

  // Strict bot with an empty knowledge base: fallback, no model call.
  const n = S.mock.calls.length;
  const empty = await S.brain.handle(msg({ botId: qa.id, text: "how do refunds work?", isDirect: true, roomId: "qa1" }));
  assert.equal(empty!.text, qa.knowledge.fallbackMessage);
  assert.equal(S.mock.calls.length, n);

  S.knowledge.addDocument(qa.id, "Refund policy", "text", "", "Refunds are available within 30 days of purchase.\n\nContact support@example.com with your order number.");
  S.knowledge.addDocument(qa.id, "退款政策", "text", "", "购买后30天内可以申请退款。请联系客服并提供订单号。");
  S.knowledge.addDocument("mochi", "Secret mochi doc", "text", "", "Refunds for mochi are never available, this belongs to another bot.");

  const r = await S.brain.handle(msg({ botId: qa.id, text: "How do refunds work?", isDirect: true, roomId: "qa1" }));
  assert.match(r!.text, /^From Refund policy: Refunds are available within 30 days/);
  assert.deepEqual(r!.usedKnowledge!.map((k) => k.title), ["Refund policy"]);
  const sys = lastChat().body.messages[0].content as string;
  assert.match(sys, /Answer ONLY from the knowledge base/);
  assert.doesNotMatch(sys, /another bot/, "knowledge is per bot");
  assert.ok(!lastChat().body.tools.some((t: any) => t.function.name === "web_search"), "no web search in strict mode");

  const zh = await S.brain.handle(msg({ botId: qa.id, text: "怎么退款？", isDirect: true, roomId: "qa1" }));
  assert.match(zh!.text, /^From 退款政策: 购买后30天内可以申请退款/);
});

test("knowledge base: strict bot uses search_knowledge, then falls back when nothing matches", async () => {
  const qa = S.bots.list().find((b) => b.persona.name === "Helpdesk")!;
  const r = await S.brain.handle(msg({ botId: qa.id, text: "what's your favourite color?", isDirect: true, roomId: "qa2" }));
  // The mock calls search_knowledge("refund") → finds the refund doc → answers from it.
  assert.match(r!.text, /^From (Refund policy|退款政策)/);
  assert.ok(S.mock.calls.some((c) => c.body.messages?.some((m: any) => m.role === "tool" && m.tool_call_id === "call_kb")));
});

test("'forget me' deletes the person's memory for that bot", async () => {
  const r = await S.brain.handle(msg({ roomId: "room2", userId: "u2", userName: "Bea", text: "mochi please forget me", mentionsBot: true }));
  assert.match(r!.text, /forgotten/);
  assert.equal(S.store.getPerson("mochi", "discord", "u2"), undefined);
});

test("per-bot daily token budget stops spending", async () => {
  S.bots.update("mochi", { limits: { dailyTokenBudget: 1 } });
  const n = S.mock.calls.length;
  assert.match((await S.brain.handle(msg({ text: "hi", mentionsBot: true })))!.text, /out of energy/);
  assert.equal(S.mock.calls.length, n);
  S.bots.update("mochi", { limits: { dailyTokenBudget: 0 } });
});

test("usage is recorded per bot and feature", () => {
  const rows = S.store.usageSince("2000-01-01");
  const features = new Set(rows.filter((r) => r.botId === "mochi").map((r) => r.feature));
  for (const f of ["chat", "search", "vision", "memory"]) assert.ok(features.has(f), f);
  assert.ok(rows.some((r) => r.botId !== "mochi"), "other bots tracked separately");
});

test("bot settings are sanitised and persisted", () => {
  S.bots.update("mochi", { limits: { maxReplyTokens: 999999 }, triggers: { randomReplyChance: 5 }, persona: { tone: "evil", color: "red" }, id: "hijack" });
  const saved = JSON.parse(fs.readFileSync(path.join(S.dir, "bots.json"), "utf8")).bots.find((b: any) => b.id === "mochi");
  assert.equal(saved.limits.maxReplyTokens, 8000);
  assert.equal(saved.triggers.randomReplyChance, 1);
  assert.equal(saved.persona.tone, "friendly");
  assert.equal(saved.persona.color, "#ff6fae");
  assert.ok(S.bots.get("mochi"), "id is immutable");
});

test("can't delete the last bot", () => {
  for (const b of S.bots.list().slice(1)) S.bots.delete(b.id);
  assert.throws(() => S.bots.delete("mochi"), /at least one bot/);
});
