import { test } from "node:test";
import assert from "node:assert/strict";
import { proxyUrl, redactedProxy } from "../src/core/proxy.ts";
import { networkProblem, UnexpectedResponseError } from "../src/core/net-errors.ts";

test("proxy URL comes from HTTPS_PROXY / HTTP_PROXY / ALL_PROXY, http(s) only", () => {
  assert.equal(proxyUrl({}), null);
  assert.equal(proxyUrl({ HTTPS_PROXY: "http://127.0.0.1:7890" }), "http://127.0.0.1:7890");
  assert.equal(proxyUrl({ http_proxy: " http://proxy.corp:3128 " }), "http://proxy.corp:3128");
  assert.equal(proxyUrl({ ALL_PROXY: "socks5://127.0.0.1:7891" }), null, "socks isn't supported: warn and ignore");
  assert.equal(redactedProxy("http://user:pass@proxy.corp:3128"), "http://***:***@proxy.corp:3128");
});

test("network failures are recognised; API answers are not", () => {
  const fetchFailed = Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("getaddrinfo ENOTFOUND api.telegram.org"), { code: "ENOTFOUND" }) });
  assert.match(networkProblem(fetchFailed)!, /^ENOTFOUND/);
  assert.equal(networkProblem(new DOMException("aborted", "TimeoutError")), "timed out after 15s");
  assert.match(networkProblem(Object.assign(new TypeError("fetch failed"), { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } }))!, /UNABLE_TO_VERIFY/);
  assert.match(networkProblem(new UnexpectedResponseError(200))!, /HTTP 200/);
  assert.equal(networkProblem(new Error("invalid")), null);
  assert.equal(networkProblem(new Error("Unauthorized")), null);
});
