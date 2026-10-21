import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  buildMaaArgs,
  buildMaaQqSummary,
  isSupportedMaaResolution,
  MaaRunner,
  parseAndroidDisplaySize,
  resolveMaaTask,
  summarizeMaaOutput,
} from "../maa.mjs";

test("MAA only accepts fixed safe tasks from the allowlist", () => {
  const config = {
    safeTasks: {
      "com.hypergryph.arknights": "arknights-safe",
      "com.example.unsafe": "mall-and-gacha",
    },
    taskAllowlist: ["arknights-safe"],
  };
  assert.equal(resolveMaaTask("com.hypergryph.arknights", config), "arknights-safe");
  assert.equal(resolveMaaTask("com.example.unsafe", config), null);
  assert.equal(resolveMaaTask("com.example.missing", config), null);
});

test("MAA device resolution accepts only official landscape modes", () => {
  const output = "Physical size: 1920x1080\nOverride size: 1080x1920";
  assert.deepEqual(parseAndroidDisplaySize(output), { width: 1080, height: 1920 });
  assert.equal(isSupportedMaaResolution({ width: 1080, height: 1920 }), true);
  assert.equal(isSupportedMaaResolution({ width: 1600, height: 900 }), false);
  assert.equal(isSupportedMaaResolution(null), false);
});

test("MAA arguments reject injected task and device strings", () => {
  assert.deepEqual(buildMaaArgs({
    task: "arknights-safe",
    address: "127.0.0.1:16384",
    logFile: "C:\\logs\\maa.log",
  }), [
    "--batch",
    "run",
    "arknights-safe",
    "--addr",
    "127.0.0.1:16384",
    "--profile",
    "default",
    "--log-file=C:\\logs\\maa.log",
  ]);
  assert.throws(() => buildMaaArgs({ task: "run; rm", address: "127.0.0.1:16384" }));
  assert.throws(() => buildMaaArgs({ task: "arknights-safe", address: "bad device" }));
});

test("MAA callback output is reduced to completed task chains and errors", () => {
  const summary = summarizeMaaOutput(
    "Summary\n[Open Arknights] 21:01:57 - 21:02:02 (5s) Completed\n[Play one safe battle] 21:02:03 - 21:03:30 (1m 26s) Completed\nbattle finished",
    "[ERR] Task failed",
  );
  assert.deepEqual(summary.completed, [
    { name: "Open Arknights", taskId: null },
    { name: "Play one safe battle", taskId: null },
  ]);
  assert.equal(summary.completedTasks, 2);
  assert.equal(summary.errors.length, 1);
  assert.match(summary.errors[0], /Task failed/);
});

test("MAA QQ summary stays in BigFish's short casual voice", () => {
  const summary = buildMaaQqSummary({
    result: { ok: true, completedTasks: 2 },
  });
  assert.match(summary, /MAA/);
  assert.match(summary, /没动药也没动石头/);
  assert.ok(summary.length < 160);
});

test("missing MAA installation fails its preflight instead of pretending to play", async () => {
  const root = await mkdtemp(join(tmpdir(), "bigfish-maa-missing-"));
  try {
    const runner = new MaaRunner({
      enabled: true,
      root,
      configDir: join(root, "config"),
      stateDir: join(root, "state"),
      cacheDir: join(root, "cache"),
      logDir: join(root, "logs"),
    });
    const probe = await runner.probe();
    assert.equal(probe.available, false);
    assert.equal(probe.reason, "missing-files");
    assert.ok(probe.missing.length >= 5);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
