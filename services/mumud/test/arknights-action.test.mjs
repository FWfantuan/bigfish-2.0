import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMaaArknightsSingleStepTask,
  normalizeMaaArknightsAction,
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
