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

test("finishes after the final event even when a tool keeps the child alive", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bigfish-dsh-test-"));
  const bin = join(directory, "hanging-dsh.mjs");
  try {
    await writeFile(
      bin,
      [
        'process.stdout.write(JSON.stringify({ type: "session", sessionId: "session-test" }) + "\\n");',
        'process.stdout.write(JSON.stringify({ type: "final", text: "{\\"action\\":\\"wait\\"}" }) + "\\n");',
        "setInterval(() => {}, 1000);",
      ].join("\n"),
      "utf8",
    );
    const dsh = new DshDecisionMaker({ bin, profile: "test" });
    const started = Date.now();
    const result = await dsh.decide({ prompt: "test", timeoutMs: 5000 });
    assert.equal(result.decision.action, "wait");
    assert.equal(result.sessionId, "session-test");
    assert.ok(Date.now() - started < 2000);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
