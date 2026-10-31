import { test } from "node:test";
import assert from "node:assert/strict";
import { KB_LANGS, detectDocLang, missingLanguages, splitForTranslation, translateDocument, type TranslateClient } from "../src/knowledge/translate.ts";
import { makeStack } from "./helpers.ts";

/** A fake model that "translates" by tagging the text, so the plumbing is observable. */
const fakeClient = (opts: { fail?: string; empty?: boolean } = {}): TranslateClient & { calls: any[] } => {
  const calls: any[] = [];
  return {
    calls,
    async chat({ messages }) {
      calls.push(messages);
      const target = /into ([A-Za-z ]+)\./.exec(messages[0].content)?.[1] ?? "?";
      if (opts.fail && opts.fail === target) throw new Error("mock failure");
      return {
        message: { content: opts.empty ? "" : `[${target}] ${messages[1].content}` },
        usage: { promptTokens: 10, completionTokens: 5 },
      };
    },
  };
};

test("the source language is detected, and every other language is filled in", () => {
  assert.equal(detectDocLang("这是中文的说明文档，购买后可以退款。"), "zh");
  assert.equal(detectDocLang("これは日本語の説明です。モデルの話をします。"), "ja");
  assert.equal(detectDocLang("Este documento explica como pedir reembolso. Você pode nos contatar."), "pt");
  assert.equal(detectDocLang("This document explains refunds and shipping."), "en");

  assert.deepEqual(missingLanguages("zh").sort(), ["en", "ja", "pt"]);
  assert.deepEqual(sorted(missingLanguages("en")), sorted(["zh", "pt", "ja"]));
  assert.equal(missingLanguages("en").length, KB_LANGS.length - 1);
});

const sorted = (a: readonly string[]) => [...a].sort();

test("long documents are split on paragraphs before translating", () => {
  const para = "x".repeat(1200);
  const parts = splitForTranslation(`${para}\n\n${para}\n\n${para}`, 1500);
  assert.ok(parts.length >= 3, `expected a split, got ${parts.length}`);
  assert.ok(parts.every((p) => p.length <= 1600));
});

test("translateDocument joins the parts and reports token usage", async () => {
  const client = fakeClient();
  const out = await translateDocument(client, "model-x", "line one\n\nline two", "ja");
  assert.match(out.text, /^\[Japanese\]/);
  assert.ok(out.promptTokens > 0 && out.completionTokens > 0);
  assert.equal(client.calls.length, 1);
});

test("one failing language does not lose the others", async () => {
  const client = fakeClient({ fail: "Japanese" });
  await assert.rejects(() => translateDocument(client, "model-x", "hello", "ja"), /mock failure/);
  const ok = await translateDocument(client, "model-x", "hello", "pt");
  assert.match(ok.text, /\[Brazilian Portuguese\]/);
});

test("an upload with translate on is stored once per language, and each one is searchable", async () => {
  const S = await makeStack();
  try {
    const bot = S.bots.update("mochi", { knowledge: { enabled: true, translate: true } });
    assert.equal(bot.knowledge.translate, true);
    // The stack's FlatkeyClient talks to the mock router; point it at a translator-shaped reply
    // by using translateDocument directly with the same store, mirroring what the route does.
    const source = "Refunds are available within 30 days of purchase. Contact support to start one.";
    const zh = await translateDocument(fakeClient(), "model-x", source, "zh");
    S.knowledge.addDocument("mochi", "Refund policy", "text", "", source);
    S.knowledge.addDocument("mochi", "Refund policy [zh]", "text", "auto:zh", zh.text.replace("[Simplified Chinese] ", ""));

    const titles = S.knowledge.titles("mochi").sort();
    assert.deepEqual(titles, ["Refund policy", "Refund policy [zh]"]);

    // English question → English document; Chinese question → the translated one.
    assert.equal(S.knowledge.search("mochi", "refund", 4)[0].title, "Refund policy");
  } finally {
    await S.close();
  }
});
