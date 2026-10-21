import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainConsolidator } from "../consolidator.mjs";
import { BrainStore } from "../store.mjs";

test("brain stores context, goals, reflections, skills and approvals", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bigfish-brain-"));
  const store = new BrainStore(join(dir, "brain.sqlite3"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  store.setSelf("group:1", { mood: "curious", focus: "看看群友在聊什么" });
  store.addFact("group:1", "群友喜欢 FF14", { importance: 0.8 });
  const goal = store.createGoal("group:1", "检查新版本", "等待主人批准");
  store.addEvent("group:1", "message", { text: "新版本开了" });
  store.addAction("group:1", "reply", {}, "收到", true);
  store.upsertSkill("group:1", {
    name: "查版本",
    domain: "general",
    trigger: "群友问新版本",
    steps: ["查询官方公告", "核对日期"],
  });
  store.upsertSkill("group:1", {
    name: "查版本",
    domain: "general",
    trigger: "群友问新版本",
    steps: ["查询官方公告", "核对日期"],
  });
  const approval = store.createApproval("group:1", "computer", "需要操作电脑");
  store.decideApproval(approval.id, true);
  const context = store.context("group:1");
  assert.equal(context.self.mood, "curious");
  assert.equal(context.goals[0].id, goal.id);
  assert.equal(context.facts[0].text, "群友喜欢 FF14");
  assert.equal(context.skills[0].status, "active");
  assert.equal(store.approvals("group:1", "approved")[0].id, approval.id);
});

test("consolidator turns experiences into facts and skill candidates", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bigfish-brain-"));
  const store = new BrainStore(join(dir, "brain.sqlite3"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  for (let index = 0; index < 4; index += 1) {
    store.addEvent("group:2", "message", { text: `事件 ${index}` });
  }
  const config = { dsh: { profile: "bigfish-social", timeoutMs: 1000 } };
  const consolidator = new BrainConsolidator(store, config, { minimumEvents: 2 });
  consolidator.dsh = {
    decide: async () => ({
      decision: {
        reflection: "多次查版本后应先看官方公告。",
        lessons: ["先核对来源"],
        facts: [{ text: "查版本应优先用官方公告", confidence: 0.9, importance: 0.8 }],
        skills: [{
          name: "查官方版本",
          domain: "general",
          trigger: "群友询问游戏版本",
          steps: ["搜索官方公告", "核对发布日期"],
          success: true,
        }],
      },
    }),
  };
  const result = await consolidator.consolidateScope("group:2");
  assert.equal(result.facts, 1);
  assert.equal(store.facts("group:2")[0].text, "查版本应优先用官方公告");
  assert.equal(store.skills("group:2", false)[0].status, "candidate");
});
