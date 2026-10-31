import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * The dashboard shows a copy-paste Slack manifest. If it ever drifts from
 * docs/slack-app-manifest.json, one of the two is wrong and the user gets a broken app —
 * so the inline copy is compared to the file, and both are checked for the settings that
 * actually make Mochi work (Socket Mode, scopes, events, messages tab).
 */

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** Pull `const SLACK_MANIFEST = {...};` out of the browser bundle and evaluate it. */
function inlineManifest(): any {
  const src = read("public/dashboard/app.js");
  const start = src.indexOf("const SLACK_MANIFEST");
  assert.ok(start >= 0, "SLACK_MANIFEST not found in app.js");
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) {
        const literal = src.slice(open, i + 1);
        return vm.runInNewContext(`(${literal})`);
      }
    }
  }
  throw new Error("unterminated SLACK_MANIFEST");
}

test("the manifest shown in the dashboard matches docs/slack-app-manifest.json", () => {
  const file = JSON.parse(read("docs/slack-app-manifest.json"));
  // Round-trip through JSON: the vm context gives objects from another realm, which
  // deepStrictEqual refuses to compare by prototype.
  const inline = JSON.parse(JSON.stringify(inlineManifest()));
  assert.deepEqual(inline, file);
});

test("the manifest carries everything Mochi needs to work", () => {
  const m = JSON.parse(read("docs/slack-app-manifest.json"));

  assert.equal(m.settings.socket_mode_enabled, true, "Socket Mode must be on (no public URL)");
  assert.equal(m.features.app_home.messages_tab_enabled, true, "DMs need the Messages tab");
  assert.equal(m.features.app_home.messages_tab_read_only_enabled, false, "read-only blocks sending");

  const scopes: string[] = m.oauth_config.scopes.bot;
  for (const need of ["app_mentions:read", "channels:history", "groups:history", "im:history", "chat:write", "users:read", "files:read", "channels:read"])
    assert.ok(scopes.includes(need), `missing scope ${need}`);

  const events: string[] = m.settings.event_subscriptions.bot_events;
  for (const need of ["app_mention", "message.channels", "message.groups", "message.im"])
    assert.ok(events.includes(need), `missing event ${need}`);
});
