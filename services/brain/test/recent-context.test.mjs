import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainStore } from "../store.mjs";

test("brain context exposes recent conversation actions after a restart", async () => {
  const directory = await mkdtemp(join(tmpdir(), "bigfish-recent-context-"));
  const store = new BrainStore(join(directory, "brain.sqlite3"));
  try {
    store.addAction(
      "group:805070822",
      "qq_agent_turn",
      { userMessage: "刚才说到 MAA 放干员" },
      "我在看日志",
      true,
    );
    const context = store.context("group:805070822");
    assert.equal(context.recentActions.length, 1);
    assert.equal(context.recentActions[0].kind, "qq_agent_turn");
    assert.equal(context.recentActions[0].payload.userMessage, "刚才说到 MAA 放干员");
  } finally {
    store.close();
    await rm(directory, { recursive: true, force: true });
  }
});
