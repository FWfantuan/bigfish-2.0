import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameplayPrompt,
  findTargetPackage,
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
