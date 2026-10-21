import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScreenDeployGesture,
  buildMaaArknightsSingleStepTask,
  normalizeMaaArknightsAction,
  normalizeScreenPoint,
} from "../arknights-action-core.mjs";

test("Deploy becomes one MAA stage step and one pause-aware action step", () => {
  const task = buildMaaArknightsSingleStepTask({
    stageName: "ro1_e_1_1",
    action: {
      type: "Deploy",
      name: "能天使",
      location: [4, 2],
      direction: "Right",
      costs: 14,
      postDelay: 250,
    },
  });

  assert.equal(task.tasks.length, 2);
  assert.deepEqual(task.tasks[0].params, {
    type: "copilot",
    subtype: "stage",
    details: { stage_name: "ro1_e_1_1" },
  });
  assert.deepEqual(task.tasks[1].params.details, {
    actions: [{
      type: "Deploy",
      name: "能天使",
      location: [4, 2],
      direction: "Right",
      costs: 14,
      post_delay: 250,
    }],
  });
});

test("BigFish can schedule skills and rejects MAA strategy automation", () => {
  assert.deepEqual(normalizeMaaArknightsAction({
    type: "Skill",
    name: "银灰",
    kills: 18,
    preDelay: 100,
  }), {
    type: "Skill",
    name: "银灰",
    kills: 18,
    pre_delay: 100,
  });

  assert.throws(
    () => normalizeMaaArknightsAction({ type: "SkillDaemon" }),
    /unsupported Arknights action type/,
  );
  assert.throws(
    () => normalizeMaaArknightsAction({
      type: "Deploy",
      name: "能天使",
      location: [4, 2],
    }),
    /direction is required/,
  );
});

test("screen deployment converts normalized visual points and direction to ADB coordinates", () => {
  assert.deepEqual(normalizeScreenPoint([0.25, 0.9], "card"), [0.25, 0.9]);
  assert.deepEqual(
    buildScreenDeployGesture({
      cardPoint: [0.25, 0.93],
      tilePoint: [0.5, 0.5],
      direction: "Right",
      width: 1920,
      height: 1080,
    }),
    {
      card: { x: 480, y: 1004 },
      tile: { x: 960, y: 540 },
      direction: "Right",
      end: { x: 1057, y: 540 },
    },
  );
  assert.throws(
    () => normalizeScreenPoint([2, 0.5], "tile"),
    /normalized from 0 to 1/,
  );
});
