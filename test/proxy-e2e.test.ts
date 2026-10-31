import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { Bot } from "grammy";
import { configureProxy, proxyAgent } from "../src/core/proxy.ts";

/**
 * With HTTPS_PROXY set, Mochi's traffic must actually go through the proxy:
 * both Node's fetch (token checks, Flatkey, images) and grammy (Telegram polling + replies).
 * A local proxy routes every hostname to a fake Telegram API and records what passed through.
 */
let api: http.Server;
let proxy: http.Server;
let apiPort = 0;
const seen: string[] = [];

before(async () => {
  api = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, result: { id: 42, is_bot: true, first_name: "Mochi", username: "mochi_test_bot" } }));
  });
  await new Promise<void>((r) => api.listen(0, "127.0.0.1", r));
  apiPort = (api.address() as AddressInfo).port;

  proxy = http.createServer((req, res) => {
    // Plain HTTP proxying (absolute-form request URI).
    seen.push(`GET ${req.url}`);
    const target = new URL(req.url!);
    const up = http.request({ host: "127.0.0.1", port: apiPort, path: target.pathname + target.search, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    req.pipe(up);
  });
  // CONNECT tunnels (what HttpsProxyAgent uses), routed to the fake API whatever the host.
  proxy.on("connect", (req, socket: net.Socket, head) => {
    seen.push(`CONNECT ${req.url}`);
    const up = net.connect(apiPort, "127.0.0.1", () => {
      socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
  configureProxy({ HTTPS_PROXY: proxyUrl, NO_PROXY: "" });
});

after(() => {
  api.close();
  proxy.close();
});

test("fetch goes through the proxy", async () => {
  const r = await fetch("http://api.telegram.example/bot123:abc/getMe");
  const body: any = await r.json();
  assert.equal(body.result.username, "mochi_test_bot");
  assert.ok(seen.some((s) => s.includes("api.telegram.example")), seen.join("\n"));
});

test("grammy (Telegram polling + replies) goes through the proxy", async () => {
  const agent = proxyAgent();
  assert.ok(agent, "agent is configured");
  const bot = new Bot("123:abc", { client: { apiRoot: "http://api.telegram.example", baseFetchConfig: { agent, compress: true } } });
  await bot.init();
  assert.equal(bot.botInfo.username, "mochi_test_bot");
  assert.ok(seen.some((s) => s.startsWith("CONNECT api.telegram.example")), seen.join("\n"));
});
