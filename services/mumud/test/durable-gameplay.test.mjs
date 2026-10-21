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
  assert.match(main, /groupId: String\(groupId\)/);
  assert.match(main, /captureGameplayScreenshot\(device\)/);
  assert.match(main, /brainScope\(ownerRequest\?\.groupId \|\| notifyGroup\)/);
  assert.match(main, /activeGroupId = String\(ownerRequest\.groupId\)/);
  assert.match(main, /beginActiveSession/);
  assert.match(main, /activeSession: state\.activeSession/);
  assert.match(main, /reportInterruptedGameplay/);
  assert.match(main, /gameplay_process_interrupted/);
  assert.match(main, /composeGameplayMessage/);
  assert.match(main, /profile: "bigfish-social"/);
  assert.doesNotMatch(main, /我刚刚突然想玩/);
  assert.doesNotMatch(main, /buildMaaQqSummary/);
  assert.match(tools, /arknights_ask_owner/);
  assert.match(tools, /opening squad\/operators/);
  assert.match(tools, /--log-file=\$\{logPath\}/);
  assert.match(tools, /details\?\.actions\?\.\[0\]\?\.type/);
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

test("QQ chat has a read-only gameplay status tool", async () => {
  const tools = await readFile("patches/qq-game-request-tool.snippet.js", "utf8");

  assert.match(tools, /bigfish_gameplay_status/);
  assert.match(tools, /The bigfish-play worker owns MuMu/);
  assert.match(tools, /Do not call android_interact/);
  assert.match(tools, /ctx\.tools\.guard/);
  assert.match(tools, /mutatingAndroidTools/);
});
