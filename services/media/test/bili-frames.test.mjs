import assert from "node:assert/strict";
import test from "node:test";
import {
  planFrameTimestamps,
  resolveBilibiliPage,
} from "../bili-frames.mjs";

test("multi-part videos resolve the requested page and duration", () => {
  const selected = resolveBilibiliPage({
    title: "合集",
    pages: [
      { cid: 11, page: 1, part: "第一集", duration: 658 },
      { cid: 22, page: 2, part: "第二集", duration: 162 },
    ],
  }, 2);
  assert.equal(selected.cid, 22);
  assert.equal(selected.page, 2);
  assert.equal(selected.duration, 162);
  assert.match(selected.title, /P2/);
  assert.match(selected.title, /第二集/);
});

test("an owner timestamp extracts that exact location", () => {
  assert.deepEqual(
    planFrameTimestamps({ duration: 926, count: 1, timestampSeconds: 658 }),
    [658],
  );
  assert.deepEqual(
    planFrameTimestamps({ duration: 10, count: 1, timestampSeconds: 99 }),
    [9],
  );
});

test("an unspecified timestamp avoids the opening frame", () => {
  const [timestamp] = planFrameTimestamps({ duration: 100, count: 1 });
  assert.equal(timestamp, 40);
  const many = planFrameTimestamps({ duration: 100, count: 3 });
  assert.deepEqual(many, [25, 50, 75]);
});
