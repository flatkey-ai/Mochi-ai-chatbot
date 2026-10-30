import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { flatkeyUrl } from "../src/flatkey/why.ts";

const root = path.resolve(import.meta.dirname, "..");
const FILES = ["README.md", "README.zh-CN.md", "README.ja-JP.md", "README.pt-BR.md", "CONTRIBUTING.md", "CODE_OF_CONDUCT.md", "SECURITY.md", ".github/ISSUE_TEMPLATE/config.yml", ".env.example", "public/widget/widget.js", "public/dashboard/index.html", "public/dashboard/app.js", "src/flatkey/why.ts", "src/server/app.ts"];
const MEDIUMS = ["local_deploy", "dashboard", "github", "web_widget"];

test("flatkeyUrl builds the full UTM set", () => {
  const u = new URL(flatkeyUrl("keys", "local_deploy", "startup_banner"));
  assert.equal(u.origin + u.pathname, "https://console.flatkey.ai/keys");
  assert.equal(u.searchParams.get("utm_source"), "mochi_bot");
  assert.equal(u.searchParams.get("utm_medium"), "local_deploy");
  assert.equal(u.searchParams.get("utm_campaign"), "mochi");
  assert.equal(u.searchParams.get("utm_content"), "startup_banner");
});

test("every user-facing Flatkey link in the repo carries the UTM scheme", () => {
  const re = /https:\/\/(?:console\.)?flatkey\.ai\/[^\s"'`)<>]*/g;
  let count = 0;
  for (const f of FILES) {
    const text = fs.readFileSync(path.join(root, f), "utf8");
    for (const m of text.matchAll(re)) {
      const raw = m[0].replace(/[.,]+$/, "");
      if (raw.includes("${")) continue; // template built at runtime by flatkeyUrl
      if (new URL(raw).pathname.startsWith("/v1/")) continue; // API endpoints, not links people click
      const u = new URL(raw);
      if (u.pathname === "/" && !u.search && f === "src/flatkey/why.ts") continue; // DESTINATIONS base
      if (u.pathname === "/keys" && !u.search && f === "src/flatkey/why.ts") continue;
      count++;
      assert.equal(u.searchParams.get("utm_source"), "mochi_bot", `${f}: ${raw}`);
      assert.ok(MEDIUMS.includes(u.searchParams.get("utm_medium") ?? ""), `${f}: ${raw}`);
      assert.equal(u.searchParams.get("utm_campaign"), "mochi", `${f}: ${raw}`);
      assert.ok(u.searchParams.get("utm_content"), `${f}: ${raw}`);
    }
  }
  assert.ok(count >= 6, `expected many tracked links, found ${count}`);
});
