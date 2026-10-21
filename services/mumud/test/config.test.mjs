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
  assert.deepEqual(gameplay.maa.safeTasks, {});
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

test("generic Arknights play and Black Flow Tree Sea stay in the agentic path", async () => {
  const gameplay = JSON.parse(await readFile("config/gameplay.json", "utf8"));
  const open = gameplay.agenticGameplay.modes.find(
    (entry) => entry.id === "arknights-open",
  );
  const roguelike = gameplay.agenticGameplay.modes.find(
    (entry) => entry.id === "arknights-roguelike",
  );

  assert.ok(open);
  assert.ok(roguelike.keywords.includes("黑流树海"));
  assert.equal(gameplay.gameAliases["黑流树海"], "com.hypergryph.arknights");
});

test("autonomous play uses a short cooldown and does not require a new permission prompt", async () => {
  const gameplay = JSON.parse(await readFile("config/gameplay.json", "utf8"));

  assert.ok(gameplay.cooldownMinutes <= 10);
  assert.match(gameplay.autonomy.objective, /不需要每次等主人说“去玩吧”/);
  assert.match(gameplay.autonomy.objective, /只结束当前这一局/);
});
