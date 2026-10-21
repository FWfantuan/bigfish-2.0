import assert from "node:assert/strict";
import test from "node:test";
import {
  buildGameChoicePrompt,
  buildGameplayObservationPrompt,
  buildGameplayPrompt,
  extractGameplayQqSummary,
  findTargetPackage,
  normalizeGameChoice,
  normalizeGameplayObservation,
  parseInstalledPackages,
  parseOnlineDevices,
  reconcileDevicePresence,
  resolveAgenticGameplayMode,
  resolveConfiguredGame,
  sessionGate,
  validateGameplayRequest,
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

test("owner gameplay requests are short-lived, group-bound and owner-only", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const request = {
    requestedAt: "2026-10-21T11:59:00Z",
    scope: "group",
    groupId: "805070822",
    isOwner: true,
  };
  assert.equal(validateGameplayRequest(request, "805070822", now), true);
  assert.equal(validateGameplayRequest({ ...request, groupId: "1" }, "805070822", now), false);
  assert.equal(validateGameplayRequest({ ...request, isOwner: false }, "805070822", now), false);
  assert.equal(validateGameplayRequest({ ...request, requestedAt: "2026-10-21T11:49:00Z" }, "805070822", now), false);
});

test("owner request is included in the autonomous game choice prompt", () => {
  const prompt = buildGameChoicePrompt({
    autonomy: { enabled: true },
    packages: ["com.example.game"],
    ownerRequest: {
      game: "明日方舟",
      reason: "主人叫我现在去玩",
    },
  });
  assert.match(prompt, /主人在白名单群明确叫你现在玩/);
  assert.match(prompt, /明日方舟/);
  assert.match(prompt, /不能绕过任何安全边界/);
});

test("configured game aliases resolve an owner-named game without another model choice", () => {
  assert.deepEqual(
    resolveConfiguredGame(
      "明日方舟",
      ["com.hypergryph.arknights", "com.example.game"],
      { "明日方舟": "com.hypergryph.arknights", FGO: "com.bilibili.fatego" },
    ),
    { displayName: "明日方舟", packageName: "com.hypergryph.arknights" },
  );
  assert.equal(
    resolveConfiguredGame("FGO", ["com.hypergryph.arknights"], { FGO: "com.bilibili.fatego" }),
    null,
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
  assert.match(prompt, /web_search/);
  assert.match(prompt, /没有真正的 image 引用/);
  assert.match(prompt, /充值、购买、看广告/);
  assert.match(prompt, /goal-1/);
  assert.match(prompt, /QQ_SUMMARY/);
});

test("agentic roguelike prompt makes BigFish decide while paused", () => {
  const prompt = buildGameplayPrompt({
    target: {
      name: "明日方舟",
      objective: "自己打完一局肉鸽",
      maxActions: 120,
      forbiddenActions: ["充值", "购买"],
    },
    device: "127.0.0.1:16384",
    packageName: "com.hypergryph.arknights",
    agenticMode: { id: "arknights-roguelike" },
  });
  assert.match(prompt, /MAA 资源只作为知识/);
  assert.match(prompt, /进入战斗后立刻点击暂停/);
  assert.match(prompt, /自己决定并操作/);
  assert.match(prompt, /连续两次操作没反应/);
  assert.match(prompt, /不要标题、编号、动作数清单、客服式总结/);
});

test("gameplay QQ summary uses the explicit persona line instead of the full report", () => {
  const raw = [
    "# 详细报告",
    "- 进入 17-18",
    "- 演习模式失败",
    "QQ_SUMMARY: 这局我去 17-18 试了下 演习没烧理智 还是没打过 先撤了",
  ].join("\n");
  assert.equal(
    extractGameplayQqSummary(raw),
    "这局我去 17-18 试了下 演习没烧理智 还是没打过 先撤了",
  );
});

test("agentic gameplay modes are selected from owner intent", () => {
  const config = {
    enabled: true,
    modes: [{
      id: "arknights-roguelike",
      keywords: ["肉鸽", "集成战略"],
    }],
  };
  assert.equal(resolveAgenticGameplayMode("帮我打最新的肉鸽", config)?.id, "arknights-roguelike");
  assert.equal(resolveAgenticGameplayMode("随便打一把", config), null);
});

test("gameplay observation is read-only and defaults to staying quiet", () => {
  const prompt = buildGameplayObservationPrompt({
    game: "明日方舟",
    modeName: "岁的界园志异",
    elapsedSeconds: 180,
    shares: 1,
    questions: 0,
  });
  assert.match(prompt, /只读观战/);
  assert.match(prompt, /大多数时刻应选择 none/);
  assert.match(prompt, /启动画面、公司 Logo、加载页、黑屏和普通菜单默认不分享/);
  assert.deepEqual(normalizeGameplayObservation({ action: "dance", text: "x" }), {
    action: "none",
    text: "",
    reason: "invalid observation action",
  });
  assert.deepEqual(normalizeGameplayObservation({
    action: "share",
    text: " 这波站位  有点意思 ",
    reason: "new combat",
  }), {
    action: "share",
    text: "这波站位 有点意思",
    reason: "new combat",
  });
});
