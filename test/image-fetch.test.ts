import { test } from "node:test";
import assert from "node:assert/strict";
import { sniffImageMime, fetchAsDataUrl } from "../src/adapters/util.ts";

/**
 * Slack (and QQ) often serve an upload as application/octet-stream, and Slack answers an
 * unauthenticated files:read request with an HTML login page. Trusting the HTTP
 * content-type alone loses real pictures; trusting it blindly would feed HTML to the
 * vision model. Sniffing the magic bytes separates those two cases.
 */

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const GIF = Buffer.from("GIF89a------------", "latin1");
const WEBP = Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ", "latin1")]);
const HTML = Buffer.from("<!DOCTYPE html><html><body>Sign in</body></html>");

test("real image signatures are recognised", () => {
  assert.equal(sniffImageMime(PNG), "image/png");
  assert.equal(sniffImageMime(JPEG), "image/jpeg");
  assert.equal(sniffImageMime(GIF), "image/gif");
  assert.equal(sniffImageMime(WEBP), "image/webp");
});

test("an HTML login page or an error body is not an image", () => {
  assert.equal(sniffImageMime(HTML), undefined);
  assert.equal(sniffImageMime(Buffer.from('{"ok":false,"error":"file_not_found"}')), undefined);
  assert.equal(sniffImageMime(Buffer.alloc(4)), undefined);
});

test("internal hosts are refused before any request is made", async () => {
  assert.equal(await fetchAsDataUrl("http://127.0.0.1:3000/dashboard/", {}, { via: "test" }), null);
  assert.equal(await fetchAsDataUrl("http://169.254.169.254/latest/meta-data/", {}, { via: "test" }), null);
});
