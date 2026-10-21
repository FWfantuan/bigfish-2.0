import assert from "node:assert/strict";
import test from "node:test";
import { inspectMessage, isSimilarReply, normalizeFollowupDecision } from "../reply-window.mjs";

test("pure image is background only", () => {
  const result = inspectMessage({
    text: "[图片]",
    raw: { message: [{ type: "image", data: { file: "a.png" } }] },
  }, "1");
  assert.equal(result.pureImage, true);
  assert.equal(result.atBot, false);
});

test("direct bot mention opens the reply path", () => {
  const result = inspectMessage({
    text: "@大肥鱼 你好",
    raw: { message: [{ type: "at", data: { qq: "1" } }, { type: "text", data: { text: " 你好" } }] },
  }, "1");
  assert.equal(result.atBot, true);
});

test("follow-up decision must be explicit", () => {
  assert.equal(normalizeFollowupDecision({ should_reply: false }).shouldReply, false);
  assert.equal(normalizeFollowupDecision({ should_reply: true, content: "接一句" }).shouldReply, true);
});

test("near duplicate replies are rejected", () => {
  assert.equal(isSimilarReply("这也太怪了吧", "这也太怪了吧"), true);
  assert.equal(isSimilarReply("这确实有点意思", "我去打个本"), false);
});
