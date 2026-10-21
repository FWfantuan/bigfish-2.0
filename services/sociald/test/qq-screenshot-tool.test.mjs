import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("owner screenshot sharing is direct and remains owner-bound", async () => {
  const source = await readFile("patches/qq-screenshot-tool.snippet.js", "utf8");

  assert.match(source, /bigfish_share_screenshot/);
  assert.match(source, /__bigfishQqOwnerBySession/);
  assert.match(source, /截图分享只允许主人使用/);
  assert.match(source, /当前群不在截图白名单/);
  assert.match(source, /client\.sendGroup/);
  assert.match(source, /client\.sendPrivate/);
  assert.doesNotMatch(source, /request_confirmation|confirm\(|等待主人确认/);
});
