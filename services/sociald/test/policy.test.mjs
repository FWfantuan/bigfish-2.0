import assert from "node:assert/strict";
import test from "node:test";
import { isQuietHour, normalizeDecision, validateDecision } from "../policy.mjs";

const config = {
  groups: ["100"],
  ownerQQ: "1",
  privateAllowlist: ["1"],
  evaluation: {
    quietStartHour: 1,
    quietEndHour: 8,
    maxMessageChars: 100,
    globalCooldownMs: 600000,
    groupCooldownMs: 1200000,
    maxActionsPerHour: 3,
  },
};

function baseState() {
  return {
    actions: [],
    groups: { 100: { lastActionAt: 0 } },
  };
}

test("quiet hours cross midnight correctly", () => {
  const settings = { quietStartHour: 23, quietEndHour: 7 };
  assert.equal(isQuietHour(new Date(2026, 0, 1, 23, 30), settings), true);
  assert.equal(isQuietHour(new Date(2026, 0, 1, 6, 59), settings), true);
  assert.equal(isQuietHour(new Date(2026, 0, 1, 8, 0), settings), false);
});

test("group action is allowed with a recent mention target", () => {
  const decision = normalizeDecision({
    action: "group_message",
    target_group: "100",
    at_qq: "2",
    message: "你刚才说的那个副本我刚好也打了。",
    reason: "群友刚提到我正在关注的内容",
  });
  const verdict = validateDecision(decision, {
    config,
    groupId: "100",
    state: baseState(),
    recentSenderIds: new Set(["2"]),
    now: new Date(2026, 0, 1, 12, 0),
  });
  assert.equal(verdict.ok, true);
});

test("proactive private messages are always blocked", () => {
  const decision = normalizeDecision({
    action: "private_message",
    target_qq: "3",
    message: "晚上好",
    reason: "想主动聊天",
  });
  assert.equal(decision.action, "wait");
  const verdict = validateDecision(decision, {
    config,
    groupId: "100",
    state: baseState(),
    now: new Date(2026, 0, 1, 12, 0),
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.decision.action, "wait");
});

test("proactive group messages must mention a member", () => {
  const decision = normalizeDecision({
    action: "group_message",
    target_group: "100",
    message: "这个我也想接一句。",
    reason: "群友在讨论我正在关注的话题",
  });
  const verdict = validateDecision(decision, {
    config,
    groupId: "100",
    state: baseState(),
    recentSenderIds: new Set(["2"]),
    now: new Date(2026, 0, 1, 12, 0),
  });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "mention-required");
});

test("global cooldown blocks proactive chatter", () => {
  const now = new Date(2026, 0, 1, 12, 0);
  const state = baseState();
  state.actions.push({ at: now.getTime() - 10000, message: "旧消息" });
  const decision = normalizeDecision({
    action: "group_message",
    message: "新消息",
    reason: "群友继续讨论",
  });
  const verdict = validateDecision(decision, { config, groupId: "100", state, now });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, "global-cooldown");
});
