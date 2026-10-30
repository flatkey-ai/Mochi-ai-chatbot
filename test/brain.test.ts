import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startMockFlatkey } from "./mock-flatkey.ts";
import { FlatkeyClient } from "../src/flatkey/client.ts";
import { MemoryStore } from "../src/memory/store.ts";
import { MemoryUpdater } from "../src/memory/updater.ts";
import { SearchAbility } from "../src/abilities/search.ts";
import { SettingsStore } from "../src/core/settings.ts";
import { Brain } from "../src/core/brain.ts";
import type { IncomingMessage } from "../src/core/types.ts";

let mock: Awaited<ReturnType<typeof startMockFlatkey>>;
let dir: string;
let settings: SettingsStore;
let store: MemoryStore;
let updater: MemoryUpdater;
let brain: Brain;

before(async () => {
  mock = await startMockFlatkey();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-test-"));
  settings = new SettingsStore(dir);
  store = new MemoryStore(dir);
  const flatkey = new FlatkeyClient("test-key", mock.url);
  const get = () => settings.get();
  updater = new MemoryUpdater(flatkey, store, get);
  brain = new Brain({ flatkey, store, updater, search: new SearchAbility(flatkey, get), getSettings: get, random: () => 1 });
});
after(async () => {
  store.close();
  await mock.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const msg = (over: Partial<IncomingMessage>): IncomingMessage => ({
  platform: "discord",
  roomId: "room1",
  roomName: "#general",
  userId: "u1",
  userName: "Alice",
  text: "hello",
  images: [],
  isDirect: false,
  mentionsBot: false,
  ...over,
});

test("stays quiet in groups unless addressed, but still remembers the message", async () => {
  const before = mock.calls.length;
  const r = await brain.handle(msg({ text: "just chatting with friends" }));
  assert.equal(r, null);
  assert.equal(mock.calls.length, before, "no Flatkey call for unaddressed group messages");
  assert.equal(store.recentMessages("discord", "room1", 10).length, 1);
});

test("replies when @mentioned or when its name is said", async () => {
  const a = await brain.handle(msg({ text: "what's up", mentionsBot: true }));
  assert.match(a!.text, /you said/);
  const b = await brain.handle(msg({ text: "hey mochi, you there?" }));
  assert.ok(b, "name trigger");
  const c = await brain.handle(msg({ text: "mochimochi is a cake" }));
  assert.equal(c, null, "name must be a whole word");
});

test("search ability: tool call → Flatkey /v1/messages web_search → grounded answer with source", async () => {
  const r = await brain.handle(msg({ text: "what's the weather today?", mentionsBot: true }));
  assert.ok(r?.usedSearch);
  assert.match(r!.text, /sky is blue/);
  assert.match(r!.text, /example\.com\/answer/);
  assert.doesNotMatch(r!.text, /^Mochi:/, "speaker prefix stripped");
  const searchCall = mock.calls.findLast((c) => c.path === "/v1/messages")!;
  assert.equal(searchCall.body.tools[0].type, "web_search_20250305");
});

test("turning search off removes the tool (cost control)", async () => {
  settings.update({ features: { search: false } });
  const n = mock.calls.length;
  const r = await brain.handle(msg({ text: "latest news?", mentionsBot: true }));
  assert.equal(r?.usedSearch, false);
  const sent = mock.calls.slice(n).find((c) => c.path === "/v1/chat/completions")!;
  assert.equal(sent.body.tools, undefined);
  settings.update({ features: { search: true } });
});

test("vision: images go to the vision model; off = text placeholder", async () => {
  settings.update({ models: { vision: "vision-model-x" } });
  const img = { url: "data:image/png;base64,iVBORw0KGgo=" };
  const r = await brain.handle(msg({ text: "", images: [img], isDirect: true, roomId: "dm1" }));
  assert.ok(r?.usedVision);
  const sent = mock.calls.findLast((c) => c.path === "/v1/chat/completions")!;
  assert.equal(sent.body.model, "vision-model-x");
  assert.ok(sent.body.messages.at(-1).content.some((p: any) => p.type === "image_url"));

  settings.update({ features: { vision: false } });
  const r2 = await brain.handle(msg({ text: "look", images: [img], isDirect: true, roomId: "dm1" }));
  assert.equal(r2?.usedVision, false);
  const sent2 = mock.calls.findLast((c) => c.path === "/v1/chat/completions")!;
  assert.equal(typeof sent2.body.messages.at(-1).content, "string");
  settings.update({ features: { vision: true } });
});

test("memory: background update builds people profiles + room topics, and they reach the prompt", async () => {
  settings.update({ limits: { memoryUpdateEvery: 3 } });
  for (const t of ["my cat Boba knocked over my plant 😭", "lol classic", "weekend plans anyone?"]) {
    await brain.handle(msg({ roomId: "room2", userId: "u2", userName: "Bea", text: t }));
  }
  await updater.update("discord", "room2");
  const bea = store.getPerson("discord", "u2")!;
  assert.match(bea.personality, /cheerful/);
  assert.deepEqual(bea.facts, ["Bea has a cat named Boba"]);
  assert.deepEqual(store.getRoom("discord", "room2")!.recentTopics, ["cats", "weekend plans"]);

  const r = await brain.handle(msg({ roomId: "room2", userId: "u2", userName: "Bea", text: "hi", mentionsBot: true }));
  assert.match(r!.text, /Boba/, "remembered fact reaches the chat prompt");
  const sys = mock.calls.findLast((c) => c.path === "/v1/chat/completions")!.body.messages[0].content;
  assert.match(sys, /Recent topics: cats, weekend plans/);
});

test("memory off: no profile injection", async () => {
  settings.update({ features: { memory: false } });
  const r = await brain.handle(msg({ roomId: "room2", userId: "u2", userName: "Bea", text: "hi again", mentionsBot: true }));
  assert.doesNotMatch(r!.text, /Boba/);
  settings.update({ features: { memory: true } });
});

test("'forget me' deletes the person's memory", async () => {
  const r = await brain.handle(msg({ roomId: "room2", userId: "u2", userName: "Bea", text: "mochi please forget me", mentionsBot: true }));
  assert.match(r!.text, /forgotten/);
  // touchPerson re-creates an empty row on the next message; the profile must be gone.
  assert.equal(store.getPerson("discord", "u2"), undefined);
});

test("daily token budget stops spending", async () => {
  settings.update({ limits: { dailyTokenBudget: 1 } });
  const n = mock.calls.length;
  const r = await brain.handle(msg({ text: "hi", mentionsBot: true }));
  assert.match(r!.text, /out of energy/);
  assert.equal(mock.calls.length, n, "no Flatkey call once over budget");
  settings.update({ limits: { dailyTokenBudget: 0 } });
});

test("usage is recorded per feature", () => {
  const features = new Set(store.usageSince("2000-01-01").map((r) => r.feature));
  for (const f of ["chat", "search", "vision", "memory"]) assert.ok(features.has(f), f);
});

test("settings are sanitised and persisted", () => {
  settings.update({ limits: { maxReplyTokens: 999999 }, triggers: { randomReplyChance: 5 }, __proto__: { x: 1 } });
  const s = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
  assert.equal(s.limits.maxReplyTokens, 8000);
  assert.equal(s.triggers.randomReplyChance, 1);
});
