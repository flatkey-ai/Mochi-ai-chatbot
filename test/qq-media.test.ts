import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAttachment, attachmentUrl, stripQQMarkup } from "../src/adapters/qq.ts";

/**
 * QQ's attachment metadata is not tidy. Requiring a perfect `image/...` content type made the
 * bot answer "I got nothing" to real pictures, stickers and emoji, so classification has to
 * cope with what the platform actually sends.
 */

test("images are recognised from content type, filename or URL hint", () => {
  assert.equal(classifyAttachment({ content_type: "image/jpeg", url: "https://x/y" }), "image");
  assert.equal(classifyAttachment({ content_type: "", filename: "cat.png", url: "https://x/y" }), "image");
  assert.equal(classifyAttachment({ content_type: "application/octet-stream", filename: "cat.JPEG", url: "https://x/y" }), "image");
  assert.equal(classifyAttachment({ url: "https://multimedia.nt.qq.com.cn/download?appid=1&file_type=image&rkey=x" }), "image");
  assert.equal(classifyAttachment({ url: "https://gchat.qpic.cn/image/abc/0" }), "image");
  assert.equal(classifyAttachment({ content_type: "image/gif", url: "https://x/y.gif" }), "image");
});

test("video, voice and other files are identified instead of being dropped silently", () => {
  assert.equal(classifyAttachment({ content_type: "video/mp4", url: "https://x/v" }), "video");
  assert.equal(classifyAttachment({ filename: "clip.mov", url: "https://x/v" }), "video");
  assert.equal(classifyAttachment({ filename: "voice.silk", url: "https://x/a" }), "audio");
  assert.equal(classifyAttachment({ content_type: "audio/amr", url: "https://x/a" }), "audio");
  assert.equal(classifyAttachment({ content_type: "application/pdf", filename: "a.pdf", url: "https://x/f" }), "file");
  assert.equal(classifyAttachment({ url: "https://x/f" }), "file");
  assert.equal(classifyAttachment(null), "skip");
  assert.equal(classifyAttachment({}), "skip");
});

test("attachment URLs are made absolute without losing the query string", () => {
  assert.equal(attachmentUrl({ url: "//multimedia.nt.qq.com.cn/download?appid=1&rkey=abc" }), "https://multimedia.nt.qq.com.cn/download?appid=1&rkey=abc");
  assert.equal(attachmentUrl({ url: "https://x/y?z=1" }), "https://x/y?z=1");
  assert.equal(attachmentUrl({ url: "gchat.qpic.cn/a.png" }), "https://gchat.qpic.cn/a.png");
  assert.equal(attachmentUrl({}), "");
});

test("QQ markup becomes readable text instead of base64 noise", () => {
  const raw = '<@!123456> look <faceType=6,faceId="0",ext="eyJ0ZXh0IjoiIn0="/> cute';
  const clean = stripQQMarkup(raw);
  assert.doesNotMatch(clean, /faceType|ext=|eyJ0ZXh0|<\@/);
  assert.match(clean, /\[emoji\]/);
  assert.match(clean, /look/);
  assert.match(clean, /cute/);
  assert.equal(stripQQMarkup("plain text 你好"), "plain text 你好");
});
