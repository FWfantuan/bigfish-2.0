import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLiveGameplayEvent,
  createLiveGameplayState,
  isLiveGameplayTool,
} from "../activity.mjs";

test("gameplay activity keeps the latest meaningful action and screenshot", () => {
  let state = createLiveGameplayState({
    groupId: "100",
    game: "明日方舟",
    packageName: "com.hypergryph.arknights",
    startedAt: "2026-10-22T00:00:00.000Z",
  });
  state = applyLiveGameplayEvent(state, {
    type: "tool/call",
    data: {
      callId: "call-1",
      name: "arknights_maa_action",
      arguments: JSON.stringify({
        stageName: "急不可耐",
        action: { type: "Deploy", name: "塞雷娅", location: [3, 2], direction: "Left" },
      }),
    },
  });
  state = applyLiveGameplayEvent(state, {
    type: "tool/result",
    data: {
      toolCallId: "call-1",
      message: { isError: false, content: [{ type: "text", text: "{\"actionType\":\"Deploy\"}" }] },
      meta: { screenshotPath: "C:\\shots\\battle.png" },
    },
  });

  assert.equal(isLiveGameplayTool("arknights_maa_action"), true);
  assert.equal(isLiveGameplayTool("read_image"), false);
  assert.equal(state.current.tool, "arknights_maa_action");
  assert.equal(state.current.status, "completed");
  assert.match(state.current.summary, /Deploy 塞雷娅 \[3,2\] Left/);
  assert.equal(state.latestScreenshotPath, "C:\\shots\\battle.png");
  assert.equal(state.recentEvents.length, 2);
});

test("chain-of-thought is not copied into shared gameplay activity", () => {
  const state = createLiveGameplayState({ groupId: "100", game: "明日方舟" });
  const next = applyLiveGameplayEvent(state, {
    type: "assistant/message",
    data: {
      message: {
        content: [
          { type: "reasoning", text: "private reasoning" },
          { type: "text", text: "公开阶段说明" },
        ],
      },
    },
  });

  assert.equal(next.lastVisibleText, "公开阶段说明");
  assert.doesNotMatch(JSON.stringify(next), /private reasoning/);
});

test("live activity accepts the DSH command-line event protocol", () => {
  let state = createLiveGameplayState({ groupId: "100", game: "明日方舟" });
  state = applyLiveGameplayEvent(state, {
    type: "tool_call",
    callId: "cli-call",
    tool: "arknights_press_ui",
    input: { target: "pause_toggle" },
  });
  state = applyLiveGameplayEvent(state, {
    type: "tool_result",
    callId: "cli-call",
    status: "completed",
    result: "{\"sent\":true}",
  });
  state = applyLiveGameplayEvent(state, { type: "text", text: "公开阶段说明" });

  assert.equal(state.current.tool, "arknights_press_ui");
  assert.equal(state.current.status, "completed");
  assert.equal(state.lastVisibleText, "公开阶段说明");
  assert.equal(state.recentEvents.length, 2);
});
