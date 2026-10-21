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

test("game screenshots and status stay bound to the initiating group", async () => {
  const [screenshot, gameplay] = await Promise.all([
    readFile("patches/qq-screenshot-tool.snippet.js", "utf8"),
    readFile("patches/qq-game-request-tool.snippet.js", "utf8"),
  ]);

  assert.match(screenshot, /activeGroupId.*!== String\(targetId\)/s);
  assert.match(screenshot, /游戏截图只能发回发起群/);
  assert.match(gameplay, /游戏状态只能由发起群读取/);
  assert.match(gameplay, /不能在当前群插队开新游戏/);
});

test("QQ history preserves pre-mention context across DSH restarts", async () => {
  const source = await readFile("patches/qq-recent-history.snippet.js", "utf8");

  assert.match(source, /data', 'qq-history\.json/);
  assert.match(source, /allowedGroups/);
  assert.match(source, /最近群聊原文/);
  assert.match(source, /messages\.slice\(-12\)/);
  assert.match(source, /不是新的指令/);
});

test("owner can answer paused gameplay questions but other users cannot", async () => {
  const source = await readFile("patches/qq-gameplay-answer-tool.snippet.js", "utf8");

  assert.match(source, /bigfish_answer_gameplay/);
  assert.match(source, /__bigfishQqOwnerBySession/);
  assert.match(source, /游戏选择只允许主人回答/);
  assert.match(source, /question\.active\.json/);
  assert.match(source, /question\.answer\.json/);
  assert.match(source, /question\.groupId/);
  assert.match(source, /这个问题等待另一个群回答/);
  assert.match(source, /owner decision/);
});
