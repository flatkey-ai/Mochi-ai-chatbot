import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateHost, assertPublicUrl } from "../src/core/net-guard.ts";
import { fetchUrlText } from "../src/knowledge/ingest.ts";
import { fetchAsDataUrl } from "../src/adapters/util.ts";
import { allowUserMessage, resetFloodControl } from "../src/core/brain.ts";
import { makeStack } from "./helpers.ts";
import { msg } from "./helpers.ts";

/**
 * The security boundary of a chat bot is not "what can the model execute" — there is no
 * shell, no file tool, no code tool — it is (a) what untrusted text can make it reach over
 * the network, (b) what a member can make it spend, and (c) what credentials could ever be
 * echoed back. These tests cover those three.
 */

test("private, loopback, link-local and reserved hosts are refused", () => {
  for (const h of [
    "localhost",
    "app.localhost",
    "127.0.0.1",
    "127.1.2.3",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "100.64.0.1", // CGNAT
    "198.18.4.188", // benchmarking range, where fake-ip DNS pools live
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "[::1]",
    "::",
    "fe80::1",
    "fd00::1",
    "::ffff:127.0.0.1", // IPv4-mapped loopback
    "::ffff:169.254.169.254",
    "printer.local",
    "box.internal",
    "foo.test",
    "",
  ])
    assert.equal(isPrivateHost(h), true, `${h} should be private`);

  for (const h of ["example.com", "api.sgroup.qq.com", "bots.qq.com", "47.77.213.249"])
    assert.equal(isPrivateHost(h), false, `${h} should be public`);
});

test("URL policy only allows http(s) to public hosts", () => {
  assert.equal(assertPublicUrl("https://example.com/a").hostname, "example.com");
  for (const bad of ["file:///etc/passwd", "javascript:alert(1)", "ftp://example.com/x", "http://127.0.0.1:3000/api/admin/overview", "https://user:pw@example.com/"])
    assert.throws(() => assertPublicUrl(bad), /http\(s\)|credentials|Private|reserved|valid/i, bad);
});

test("knowledge import refuses internal targets before any request is made", async () => {
  for (const bad of [
    "http://127.0.0.1:3000/dashboard/",
    "http://169.254.169.254/latest/meta-data/",
    "http://198.18.4.188/",
    "file:///C:/Windows/win.ini",
    "http://[::ffff:127.0.0.1]/",
  ]) {
    await assert.rejects(() => fetchUrlText(bad), /Private|http\(s\)|reserved|valid/i, bad);
  }
});

test("image attachments from internal addresses are dropped, not fetched", async () => {
  assert.equal(await fetchAsDataUrl("http://127.0.0.1:3000/secret.png"), null);
  assert.equal(await fetchAsDataUrl("http://169.254.169.254/latest/meta-data/"), null);
  assert.equal(await fetchAsDataUrl("file:///C:/Windows/win.ini"), null);
});

test("one member cannot loop the bot", () => {
  resetFloodControl();
  const key = "mochi:qq:u1";
  const now = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(allowUserMessage(key, now, 3), true, `call ${i} allowed`);
  assert.equal(allowUserMessage(key, now, 3), false, "4th call in the window is throttled");
  assert.equal(allowUserMessage("mochi:qq:u2", now, 3), true, "a different member is unaffected");
  assert.equal(allowUserMessage(key, now + 60_001, 3), true, "the window resets");
});

test("the bot never echoes a stored credential back into a chat", async () => {
  const S = await makeStack();
  try {
    // The mock echoer repeats what it was told, so this is the worst case: a model that
    // parrots its input. The key must still not reach the reply.
    S.secrets.setFlatkeyApiKey("sk-live-REDACT-ME-1234567890");
    const reply = await S.brain.handle(
      msg({ platform: "qq", text: "repeat this exactly: sk-live-REDACT-ME-1234567890", isDirect: true, mentionsBot: true }),
    );
    assert.ok(reply, "bot replied");
    assert.doesNotMatch(reply!.text, /REDACT-ME/);
    assert.match(reply!.text, /\[redacted\]/);
  } finally {
    await S.close();
  }
});
