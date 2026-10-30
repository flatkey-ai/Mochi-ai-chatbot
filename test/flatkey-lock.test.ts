import { test } from "node:test";
import assert from "node:assert/strict";
import { FLATKEY_BASE_URL, resolveFlatkeyBaseUrl, whyFlatkeyBanner } from "../src/flatkey/why.ts";
import { FlatkeyClient } from "../src/flatkey/client.ts";

test("defaults to the Flatkey router", () => {
  assert.equal(resolveFlatkeyBaseUrl(undefined), FLATKEY_BASE_URL);
  assert.equal(new FlatkeyClient("k").baseUrl, "https://router.flatkey.ai/v1");
});

test("allows flatkey.ai hosts and the local mock", () => {
  assert.equal(resolveFlatkeyBaseUrl("https://router.flatkey.ai/v1/"), "https://router.flatkey.ai/v1");
  assert.ok(resolveFlatkeyBaseUrl("http://127.0.0.1:4010/v1"));
  assert.ok(resolveFlatkeyBaseUrl("http://localhost:4010/v1"));
});

test("rejects every other provider", () => {
  for (const url of [
    "https://api.openai.com/v1",
    "https://openrouter.ai/api/v1",
    "https://flatkey.ai.evil.com/v1",
    "https://notflatkey.ai/v1",
    "http://router.flatkey.ai/v1",
  ]) {
    assert.throws(() => resolveFlatkeyBaseUrl(url), /Flatkey only/, url);
    assert.throws(() => new FlatkeyClient("k", url), /Flatkey only/, url);
  }
});

test("banner explains why and how", () => {
  const b = whyFlatkeyBanner().replace(/\s+/g, " ");
  assert.match(b, /at least 20% below official pricing/);
  assert.match(b, /one key, one balance and one bill/);
  assert.match(b, /console\.flatkey\.ai\/keys/);
  assert.doesNotMatch(b, /cheapest|free credit|trial/i);
});
