import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { startMockFlatkey } from "./mock-flatkey.ts";
import { FlatkeyClient } from "../src/flatkey/client.ts";
import { MemoryStore } from "../src/memory/store.ts";
import { MemoryUpdater } from "../src/memory/updater.ts";
import { SearchAbility } from "../src/abilities/search.ts";
import { SettingsStore } from "../src/core/settings.ts";
import { SecretsStore } from "../src/core/secrets.ts";
import { Brain } from "../src/core/brain.ts";
import { createServer } from "../src/server/app.ts";

let mock: Awaited<ReturnType<typeof startMockFlatkey>>;
let dir: string;
let base: string;
let close: () => void;
let store: MemoryStore;
const H = { authorization: "Bearer admin-secret", "content-type": "application/json" };

before(async () => {
  mock = await startMockFlatkey();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mochi-srv-"));
  const settings = new SettingsStore(dir);
  const secrets = new SecretsStore(dir);
  store = new MemoryStore(dir);
  const flatkey = new FlatkeyClient(undefined, mock.url); // start with NO key
  const get = () => settings.get();
  const brain = new Brain({ flatkey, store, updater: new MemoryUpdater(flatkey, store, get), search: new SearchAbility(flatkey, get), getSettings: get });
  const app = createServer({
    brain, settings, secrets, store, flatkey, envFlatkeyKey: undefined,
    adapters: () => ({}), configured: { discord: false, telegram: false, slack: false, web: true },
    adminToken: "admin-secret", publicUrl: "http://localhost", publicDir: path.join(import.meta.dirname, "..", "public"),
  });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => server.close();
});
after(async () => {
  close();
  store.close();
  await mock.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

const j = async (p: string, init: RequestInit = {}) => {
  const r = await fetch(base + p, { ...init, headers: { ...H, ...(init.headers ?? {}) } });
  return { status: r.status, body: (await r.json()) as any };
};

test("admin API requires the token", async () => {
  const r = await fetch(base + "/api/admin/overview");
  assert.equal(r.status, 401);
});

test("starts unbound, with the tracked create-key link", async () => {
  const { body } = await j("/api/admin/overview");
  assert.equal(body.flatkey.bound, false);
  const u = new URL(body.flatkey.keysUrl);
  assert.equal(u.origin + u.pathname, "https://console.flatkey.ai/keys");
  assert.equal(u.searchParams.get("utm_source"), "mochi_bot");
  assert.equal(u.searchParams.get("utm_medium"), "local_deploy");
});

test("without a key Mochi asks the admin to bind one, and makes no Flatkey calls", async () => {
  const n = mock.calls.length;
  const { body } = await j("/api/widget/chat", { method: "POST", body: JSON.stringify({ sessionId: "s1", text: "hi" }) });
  assert.match(body.reply, /bind a Flatkey API key/);
  assert.equal(mock.calls.length, n);
});

test("rejects a key Flatkey refuses, without saving it", async () => {
  const { status, body } = await j("/api/admin/flatkey", { method: "PUT", body: JSON.stringify({ apiKey: "bad-key-1234567890" }) });
  assert.equal(status, 400);
  assert.match(body.error, /rejected/);
  assert.equal(fs.existsSync(path.join(dir, "secrets.json")), false);
});

test("binds a valid key: verified, saved 0600, masked, and Mochi wakes up", async () => {
  const key = "fk-live-abcdef1234567890";
  const { status, body } = await j("/api/admin/flatkey", { method: "PUT", body: JSON.stringify({ apiKey: key }) });
  assert.equal(status, 200);
  assert.equal(body.bound, true);
  assert.equal(body.source, "dashboard");
  assert.equal(body.models, 5);
  assert.ok(!JSON.stringify(body).includes(key), "full key never returned");
  const file = path.join(dir, "secrets.json");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).flatkeyApiKey, key);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const ov = await j("/api/admin/overview");
  assert.ok(!JSON.stringify(ov.body).includes(key), "overview never leaks the key");

  const chat = await j("/api/widget/chat", { method: "POST", body: JSON.stringify({ sessionId: "s1", text: "hello there" }) });
  assert.match(chat.body.reply, /you said/);
  assert.equal(mock.calls.at(-1)!.path, "/v1/chat/completions");
});

test("unbind returns Mochi to sleep", async () => {
  const { body } = await j("/api/admin/flatkey", { method: "DELETE" });
  assert.equal(body.bound, false);
  const chat = await j("/api/widget/chat", { method: "POST", body: JSON.stringify({ sessionId: "s1", text: "hi" }) });
  assert.match(chat.body.reply, /bind a Flatkey API key/);
});
