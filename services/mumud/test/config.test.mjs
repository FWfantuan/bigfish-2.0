import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("roguelike requests cannot dispatch a MAA strategy task", async () => {
  const gameplay = JSON.parse(await readFile("config/gameplay.json", "utf8"));
  const mode = gameplay.agenticGameplay.modes.find(
    (entry) => entry.id === "arknights-roguelike",
  );

  assert.equal(gameplay.agenticGameplay.enabled, true);
  assert.ok(mode);
  assert.equal(mode.webSearch, true);
  assert.equal(mode.maxSessionMinutes, 45);
  assert.ok(
    gameplay.maa.taskAllowlist.every(
      (task) => !String(task).startsWith("arknights-roguelike-"),
    ),
  );
  assert.deepEqual(gameplay.maa.hintTasks, []);
});

test("the configured observer may share without a total image cap", async () => {
  const gameplay = JSON.parse(await readFile("config/gameplay.json", "utf8"));
  const mode = gameplay.agenticGameplay.modes.find(
    (entry) => entry.id === "arknights-roguelike",
  );

  assert.equal(mode.observation.enabled, true);
  assert.equal(mode.observation.maxShares, 0);
  assert.ok(mode.observation.intervalMs >= 60_000);
});
