import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DshDecisionMaker, parseDecisionText } from "../dsh.mjs";

test("parses JSON wrapped in markdown fences", () => {
  const parsed = parseDecisionText('```json\n{"action":"wait","reason":"还没有合适机会"}\n```');
  assert.equal(parsed.action, "wait");
});

test("extracts JSON from incidental prose", () => {
  const parsed = parseDecisionText('决定如下：{"action":"private_message","target_qq":"1"}');
  assert.equal(parsed.target_qq, "1");
});

test("passes large prompts through stdin instead of the Windows command line", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bigfish-dsh-test-"));
  const bin = join(directory, "stdin-dsh.mjs");
  try {
    await writeFile(
      bin,
      [
        'let input = "";',
        'process.stdin.setEncoding("utf8");',
        'process.stdin.on("data", (chunk) => { input += chunk; });',
        'process.stdin.on("end", () => {',
        '  process.stdout.write(JSON.stringify({ type: "final", text: JSON.stringify({ length: input.length }) }) + "\\n");',
        '});',
      ].join("\n"),
      "utf8",
    );
    const dsh = new DshDecisionMaker({ bin, profile: "test" });
    const prompt = "x".repeat(100_000);
    const result = await dsh.decide({ prompt, timeoutMs: 5000 });
    assert.equal(result.decision.length, prompt.length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("finishes after the final event even when a tool keeps the child alive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bigfish-dsh-test-"));
  const bin = join(directory, "hanging-dsh.mjs");
  try {
    await writeFile(
      bin,
      [
        'process.stdout.write(JSON.stringify({ type: "session", sessionId: "session-test" }) + "\\n");',
        'process.stdout.write(JSON.stringify({ type: "tool/call", data: { name: "android_screenshot", arguments: "{}" } }) + "\\n");',
        'process.stdout.write(JSON.stringify({ type: "final", text: "{\\"action\\":\\"wait\\"}" }) + "\\n");',
        "setInterval(() => {}, 1000);",
      ].join("\n"),
      "utf8",
    );
    const dsh = new DshDecisionMaker({ bin, profile: "test" });
    const started = Date.now();
    const observed = [];
    const result = await dsh.decide({
      prompt: "test",
      timeoutMs: 5000,
      onEvent: (event) => observed.push(event.type),
    });
    assert.equal(result.decision.action, "wait");
    assert.equal(result.sessionId, "session-test");
    assert.deepEqual(observed, ["session", "tool/call", "final"]);
    assert.ok(Date.now() - started < 2000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("aborting a gameplay decision terminates its child process tree", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bigfish-dsh-abort-test-"));
  const bin = join(directory, "hanging-dsh.mjs");
  try {
    await writeFile(
      bin,
      [
        'process.stdout.write(JSON.stringify({ type: "session", sessionId: "session-abort" }) + "\\n");',
        "setInterval(() => {}, 1000);",
      ].join("\n"),
      "utf8",
    );
    const dsh = new DshDecisionMaker({ bin, profile: "test" });
    const controller = new AbortController();
    const pending = dsh.decide({ prompt: "test", timeoutMs: 5000, signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(pending, /aborted by host/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
