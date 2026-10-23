import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BrainConsolidator } from "../consolidator.mjs";
import { BrainStore, goalsEquivalent } from "../store.mjs";

test("brain stores context, goals, reflections, skills and approvals", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bigfish-brain-"));
  const store = new BrainStore(join(dir, "brain.sqlite3"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  store.setSelf("group:1", { mood: "curious", focus: "看看群友在聊什么" });
  store.addFact("group:1", "群友喜欢 FF14", { importance: 0.8 });
  store.upsertRelation("group:1", {
    subject: { qq: "11", name: "小鱼" },
    object: { qq: "22", name: "大鱼" },
    relation: "固定队友",
    evidence: "连续三次一起打本",
    confidence: 0.8,
    importance: 0.7,
  });
  store.addFact("group:1", "旧能力状态", { source: "runtime_status" });
  store.replaceFacts("group:1", "runtime_status", [{ text: "当前能力状态", confidence: 1, importance: 1 }]);
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
  assert.equal(context.facts.some((fact) => fact.text === "群友喜欢 FF14"), true);
  assert.equal(context.facts.some((fact) => fact.text === "旧能力状态"), false);
  assert.equal(context.facts.some((fact) => fact.text === "当前能力状态"), true);
  assert.equal(context.relations[0].relation, "固定队友");
  assert.equal(context.relations[0].evidenceCount, 1);
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
        self_update: { mood: "更谨慎", focus: "官方来源", desires: ["减少误判"] },
        lessons: ["先核对来源"],
        facts: [{ text: "查版本应优先用官方公告", confidence: 0.9, importance: 0.8 }],
        relations: [{
          subject: { qq: "11", name: "小鱼" },
          object: { qq: "22", name: "大鱼" },
          relation: "师徒",
          evidence: "小鱼明确称大鱼为师父",
          confidence: 0.9,
          importance: 0.8,
        }],
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
  assert.equal(store.relations("group:2")[0].relation, "师徒");
  assert.equal(store.skills("group:2", false)[0].status, "candidate");
  assert.equal(store.getSelf("group:2").focus, "官方来源");
});

test("relationship backfill extracts evidence-backed edges from historical memory", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bigfish-brain-"));
  const store = new BrainStore(join(dir, "brain.sqlite3"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  store.addFact("group:history", "小鹿明确称茶佬为师父，茶佬答应带他打本。");
  const config = { dsh: { profile: "bigfish-social", timeoutMs: 1000 } };
  const consolidator = new BrainConsolidator(store, config);
  consolidator.dsh = {
    decide: async () => ({
      decision: {
        relations: [{
          subject: { qq: "1001", name: "小鹿" },
          object: { qq: "1002", name: "茶佬" },
          relation: "师徒",
          evidence: "小鹿明确称茶佬为师父",
          confidence: 0.9,
          importance: 0.8,
        }],
      },
    }),
  };
  const result = await consolidator.backfillRelations("group:history");
  assert.equal(result.accepted, 1);
  assert.equal(store.relations("group:history")[0].relation, "师徒");
});

test("global memories are available to every scope without copying private goals", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bigfish-brain-"));
  const store = new BrainStore(join(dir, "brain.sqlite3"));
  t.after(async () => { store.close(); await rm(dir, { recursive: true, force: true }); });
  store.setSelf("global", { focus: "长期学习" });
  store.addFact("global", "遇到不确定动作先观察再行动", { importance: 1 });
  store.addFact("group:private", "只属于这个群的事实", { importance: 1 });
  store.createGoal("group:private", "群内目标");
  const context = store.context("group:other");
  assert.equal(context.facts.some((item) => item.text === "遇到不确定动作先观察再行动"), true);
  assert.equal(context.facts.some((item) => item.text === "只属于这个群的事实"), false);
  assert.equal(context.goals.some((item) => item.title === "群内目标"), false);
  assert.equal(context.self.focus, "长期学习");
});

test("relationship context prioritizes people mentioned in the current message", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bigfish-brain-"));
  const store = new BrainStore(join(dir, "brain.sqlite3"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  store.upsertRelation("group:relations", {
    subject: { qq: "1001", name: "茶佬" },
    object: { qq: "1002", name: "小鹿" },
    relation: "固定队友",
    confidence: 0.7,
    importance: 0.5,
  });
  store.upsertRelation("group:relations", {
    subject: { qq: "2001", name: "饭团" },
    object: { qq: "2002", name: "冰冰" },
    relation: "群主与常驻群友",
    confidence: 0.9,
    importance: 0.9,
  });
  const context = store.context("group:relations", "茶佬今天怎么没上线");
  assert.equal(context.relations[0].subjectName, "茶佬");
  assert.equal(context.relations[0].relation, "固定队友");
});

test("group relationships stay isolated while global relationships remain shared", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bigfish-brain-"));
  const store = new BrainStore(join(dir, "brain.sqlite3"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  store.upsertRelation("group:a", {
    subject: { name: "甲" },
    object: { name: "乙" },
    relation: "同群好友",
  });
  store.upsertRelation("global", {
    subject: { name: "大肥鱼" },
    object: { name: "主人" },
    relation: "主人与伙伴",
  });
  const other = store.context("group:b");
  assert.equal(other.relations.some((item) => item.relation === "同群好友"), false);
  assert.equal(other.relations.some((item) => item.relation === "主人与伙伴"), true);
});

test("goal deduplication merges variant titles and keeps one active entry", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bigfish-brain-"));
  const store = new BrainStore(join(dir, "brain.sqlite3"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const first = store.createGoal("group:3", "等冰冰把「325」讲清楚", "继续等", 2);
  store.createGoal("group:3", "合并重复：等冰冰把‘325’讲清楚", "继续等", 3);
  store.createGoal("group:3", "等冰冰把325讲清楚（合并重复目标）", "继续等", 4);
  assert.equal(goalsEquivalent(first.title, "合并重复：等冰冰把‘325’讲清楚"), true);
  assert.equal(
    goalsEquivalent("跟进大肥鱼2.0 beta 的群内反馈并验证群内可见", "验证 2.0 反馈通道对所有群友可见"),
    true,
  );
  const deduped = store.deduplicateGoals("group:3");
  assert.equal(deduped.remaining, 1);
  assert.equal(deduped.merged, 2);
  assert.equal(store.goals("group:3", "active", 20).length, 1);
});

test("goal upsert reuses an explicit existing goal id", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bigfish-brain-"));
  const store = new BrainStore(join(dir, "brain.sqlite3"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const goal = store.createGoal("group:4", "跟进反馈", "等待修复", 2);
  const updated = store.upsertGoal("group:4", {
    existing_goal_id: goal.id,
    title: "跟进群内反馈并验证可见",
    detail: "修好后验证",
    priority: 1,
    status: "active",
  });
  assert.equal(updated.id, goal.id);
  assert.equal(store.goals("group:4", "active", 20).length, 1);
});

test("roguelike skills require repeated successful evidence before activation", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "bigfish-brain-"));
  const store = new BrainStore(join(dir, "brain.sqlite3"));
  t.after(async () => {
    store.close();
    await rm(dir, { recursive: true, force: true });
  });
  const skill = {
    name: "萨卡兹低希望优先补地面",
    domain: "arknights_roguelike",
    trigger: "萨卡兹第二层希望不足",
    steps: ["停止强拿高费六星", "优先补低费稳定地面位"],
    success: true,
  };
  for (let index = 0; index < 4; index += 1) store.upsertSkill("group:5", skill);
  assert.equal(store.skills("group:5", false)[0].status, "candidate");
  store.upsertSkill("group:5", skill);
  assert.equal(store.skills("group:5", false)[0].status, "active");
  assert.equal(store.skills("group:5")[0].success_count, 5);
});
