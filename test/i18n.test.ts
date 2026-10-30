import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { PRESETS } from "../src/core/persona.ts";
import { WHY_FLATKEY } from "../src/flatkey/why.ts";
import { builtinReply, detectLang } from "../src/core/i18n.ts";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

function loadRows(): string[][] {
  const sandbox: any = { window: {} };
  vm.runInNewContext(read("public/dashboard/i18n.js").replace("const ROWS", "ROWS_OUT = null; const ROWS").replace("const I18N", "ROWS_OUT = ROWS; const I18N"), sandbox);
  return sandbox.ROWS_OUT;
}

/** Every string the dashboard passes to t(), plus data-i18n attributes in index.html. */
function uiKeys(): string[] {
  const keys = new Set<string>();
  for (const m of read("public/dashboard/app.js").matchAll(/\bt\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) keys.add(vm.runInNewContext(m[1]));
  const dec = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  for (const m of read("public/dashboard/index.html").matchAll(/data-i18n(?:-placeholder)?="([^"]*)"/g)) keys.add(dec(m[1]));
  return [...keys];
}

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const tags = (s: string) => [...s.matchAll(/<\/?([a-z]+)/gi)].map((m) => m[1].toLowerCase()).sort();

test("every dashboard string has Português, 日本語 and 中文 translations", () => {
  const rows = loadRows();
  const have = new Set(rows.map((r) => r[0]));
  const serverStrings = [WHY_FLATKEY.slogan, ...WHY_FLATKEY.points.flatMap((p) => [p.title, p.body]), ...Object.values(PRESETS).flatMap((p) => [p.label, p.blurb])];
  const missing = [...uiKeys(), ...serverStrings].filter((k) => !have.has(k));
  assert.deepEqual(missing, [], `missing translations:\n${missing.join("\n")}`);
});

test("translations keep placeholders and HTML tags, with no duplicates", () => {
  const rows = loadRows();
  const seen = new Set<string>();
  for (const row of rows) {
    assert.equal(row.length, 4, `row needs en/pt/ja/zh: ${row[0]}`);
    assert.ok(!seen.has(row[0]), `duplicate key: ${row[0]}`);
    seen.add(row[0]);
    for (const tr of row.slice(1)) {
      assert.ok(tr && tr.trim(), `empty translation for: ${row[0]}`);
      assert.deepEqual(placeholders(tr), placeholders(row[0]), `placeholders differ: ${row[0]} → ${tr}`);
      assert.deepEqual(tags(tr), tags(row[0]), `HTML tags differ: ${row[0]} → ${tr}`);
    }
  }
});

test("bot built-in replies follow the user's language", () => {
  assert.equal(detectLang("怎么退款？"), "zh");
  assert.equal(detectLang("ありがとうございます"), "ja");
  assert.equal(detectLang("você pode me ajudar? não entendi"), "pt");
  assert.equal(detectLang("hello there"), "en");
  assert.match(builtinReply("budget", "今天还能聊吗"), /[一-鿿]/);
  assert.match(builtinReply("asleep", "こんにちは"), /[぀-ヿ]/);
  assert.match(builtinReply("forgot", "me esquece por favor, não quero", { name: "Ana" }), /Ana/);
  assert.match(builtinReply("glitch", "hi"), /glitched/);
});
