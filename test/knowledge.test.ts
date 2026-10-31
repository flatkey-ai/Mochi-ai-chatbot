import { test } from "node:test";
import assert from "node:assert/strict";
import { makeStack } from "./helpers.ts";

/**
 * Retrieval quality rules that the "which model do you use?" incident exposed:
 * title matches must count, and the model must be told what documents exist so it can
 * search them with the right words.
 */

test("a document about the question outranks one that merely mentions the word", async () => {
  const S = await makeStack();
  try {
    // "Shipping" only appears in the Warranty body; the Shipping doc is *about* shipping.
    S.knowledge.addDocument("mochi", "Warranty", "text", "", "All products carry a 2-year warranty. See the shipping label for the serial number.");
    S.knowledge.addDocument("mochi", "Shipping policy", "text", "", "Orders leave the warehouse within 2 business days and arrive in 3 to 7 days.");

    const hits = S.knowledge.search("mochi", "shipping policy", 4);
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].title, "Shipping policy", "title match wins");
  } finally {
    await S.close();
  }
});

test("document titles are listed so the bot knows what it can look up", async () => {
  const S = await makeStack();
  try {
    S.knowledge.addDocument("mochi", "Refund policy", "text", "", "Refunds are available within 30 days of purchase.");
    S.knowledge.addDocument("mochi", "Pricing", "text", "", "Plans start at $9 per seat per month.");
    const titles = S.knowledge.titles("mochi");
    assert.deepEqual(titles.sort(), ["Pricing", "Refund policy"]);
  } finally {
    await S.close();
  }
});

test("an unanswered question retrieves nothing instead of the nearest noise", async () => {
  const S = await makeStack();
  try {
    S.knowledge.addDocument("mochi", "Refund policy", "text", "", "Refunds are available within 30 days of purchase.");
    // Cross-language gap is a known limitation (FTS5 trigram is per-script): a Chinese
    // question against an English-only corpus finds nothing. Strict bots then fall back.
    const zh = S.knowledge.search("mochi", "怎么退款", 4);
    assert.equal(zh.length, 0, "no silent garbage: an English corpus can't answer 中文");
    // A bilingual document is the documented workaround.
    S.knowledge.addDocument("mochi", "退款政策", "text", "", "购买后 30 天内可以申请退款，联系客服即可。");
    assert.equal(S.knowledge.search("mochi", "怎么退款", 4)[0].title, "退款政策");
  } finally {
    await S.close();
  }
});
