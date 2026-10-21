import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("gameplay final reports and strategic questions are wired to screenshots", async () => {
  const [main, tools] = await Promise.all([
    readFile("services/mumud/main.mjs", "utf8"),
    readFile("patches/arknights-actions-tool.snippet.js", "utf8"),
  ]);

  assert.match(main, /sendGameplayFinalReport/);
  assert.match(main, /startGameplayQuestionBridge/);
  assert.match(main, /question\.request\.json/);
  assert.match(main, /question\.answer\.json/);
  assert.match(main, /captureGameplayScreenshot\(device\)/);
  assert.match(tools, /arknights_ask_owner/);
  assert.match(tools, /opening squad\/operators/);
});

test("mumud has a single-instance login supervisor with auto restart", async () => {
  const [runner, installer] = await Promise.all([
    readFile("scripts/run-mumud-supervisor.ps1", "utf8"),
    readFile("scripts/install-mumud-supervisor.ps1", "utf8"),
  ]);

  assert.match(runner, /BigFishMumudSupervisor/);
  assert.match(runner, /WaitOne\(0\)/);
  assert.match(runner, /Start-Sleep -Seconds 5/);
  assert.match(runner, /play:start/);
  assert.match(installer, /Startup/);
  assert.match(installer, /BigFishMumudSupervisor\.vbs/);
});
