import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameChoicePrompt,
  buildGameplayPrompt,
  findTargetPackage,
  normalizeGameChoice,
  parseInstalledPackages,
  parseOnlineDevices,
  reconcileDevicePresence,
  sessionGate,
} from "../core.mjs";

test("parses only online adb devices", () => {
  const output = `List of devices attached
127.0.0.1:16384\tdevice product:manet model:23117RK66C transport_id:3
emulator-5554\toffline
phone-1\tunauthorized
`;
  assert.deepEqual(parseOnlineDevices(output), ["127.0.0.1:16384"]);
});

test("parses and selects the intended game package", () => {
  const packages = parseInstalledPackages(`package:com.example.game.helper
package:com.example.game
package:com.netease.nie.yosemite
`);
  assert.deepEqual(packages, [
    "com.example.game.helper",
    "com.example.game",
    "com.netease.nie.yosemite",
  ]);
  assert.equal(
    findTargetPackage(packages, {
      packageQueries: ["com.example.game", "example.game"],
    }),
    "com.example.game",
  );
});

test("a newly opened emulator can start again while an online session is cooled down", () => {
  const completedAt = 1_000_000;
  const state = {
    running: false,
    lastDevice: "127.0.0.1:16384",
    lastSessionAt: completedAt,
  };
  assert.deepEqual(sessionGate(state, completedAt + 60_000, 60), {
    allowed: false,
    reason: "cooldown",
    remainingMs: 3_540_000,
  });

  const reopened = reconcileDevicePresence(state, "");
  assert.equal(reopened.lastDevice, "");
  assert.equal(reopened.lastSessionAt, 0);
  assert.equal(sessionGate(reopened, completedAt + 60_000, 60).allowed, true);
  assert.equal(reconcileDevicePresence(reopened, "127.0.0.1:16384").lastSessionAt, 0);
});

test("running sessions are never started twice", () => {
  assert.deepEqual(
    sessionGate({ running: true, lastSessionAt: 0 }, Date.now(), 0),
    { allowed: false, reason: "running" },
  );
});

test("autonomous choice accepts an installed package and preserves the agent's reason", () => {
  const choice = normalizeGameChoice({
    action: "play",
    package_name: "com.example.game",
    display_name: "新发现的小游戏",
    objective: "先玩十分钟，看懂规则",
    reason: "今天想试个没玩过的",
    inner_state: { mood: "好奇", focus: "新游戏", desire: "探索玩法" },
  }, ["com.example.game", "com.example.tool"]);
  assert.equal(choice.action, "play");
  assert.equal(choice.packageName, "com.example.game");
  assert.equal(choice.reason, "今天想试个没玩过的");
  assert.deepEqual(choice.innerState, {
    mood: "好奇",
    focus: "新游戏",
    desire: "探索玩法",
  });
});

test("autonomous choice cannot launch an invented or non-third-party package", () => {
  const choice = normalizeGameChoice({
    action: "play",
    package_name: "com.android.settings",
  }, ["com.example.game"]);
  assert.equal(choice.action, "skip");
  assert.match(choice.reason, /不是当前可验证的第三方安装包/);
});

test("autonomous choice may decide not to play", () => {
  assert.deepEqual(
    normalizeGameChoice({ action: "skip", reason: "现在更想安静待着" }, ["com.example.game"]),
    { action: "skip", reason: "现在更想安静待着" },
  );
});

test("game choice prompt gives BigFish freedom instead of prescribing a game", () => {
  const prompt = buildGameChoicePrompt({
    autonomy: { enabled: true },
    packages: ["com.example.game"],
    brainContext: { self: { mood: "放松" }, skills: [] },
  });
  assert.match(prompt, /可以重温喜欢的东西/);
  assert.match(prompt, /也可以觉得现在没兴致而选择不玩/);
  assert.match(prompt, /com\.example\.game/);
});

test("gameplay prompt carries action limits, vision failure handling and safety stops", () => {
  const prompt = buildGameplayPrompt({
    target: {
      name: "示例游戏",
      objective: "完成一局",
      maxActions: 30,
      forbiddenActions: ["充值", "购买", "看广告"],
    },
    device: "127.0.0.1:16384",
    packageName: "com.example.game",
    goalId: "goal-1",
  });
  assert.match(prompt, /最多进行 30 个有意义动作/);
  assert.match(prompt, /没有真正的 image 引用/);
  assert.match(prompt, /充值、购买、看广告/);
  assert.match(prompt, /goal-1/);
});
