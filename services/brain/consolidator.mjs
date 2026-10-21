import { DshDecisionMaker, parseDecisionText } from "../sociald/dsh.mjs";

export class BrainConsolidator {
  constructor(store, config, options = {}) {
    this.store = store;
    this.config = config;
    this.dsh = new DshDecisionMaker(config.dsh);
    this.minimumEvents = options.minimumEvents ?? 4;
    this.running = new Set();
  }

  async consolidateScope(scope, force = false) {
    if (this.running.has(scope)) return null;
    const pending = this.store.unreflected(scope);
    const count = pending.events.length + pending.actions.length;
    if (!force && count < this.minimumEvents) return null;
    this.running.add(scope);
    try {
      const prompt = buildReflectionPrompt(scope, pending, this.store.context(scope));
      const result = await this.dsh.decide({ prompt, timeoutMs: this.config.dsh.timeoutMs });
      const decision = result.decision || parseDecisionText(result.raw);
      if (!decision || typeof decision !== "object") return null;
      const reflection = typeof decision.reflection === "string" ? decision.reflection.trim() : "";
      const facts = Array.isArray(decision.facts) ? decision.facts : [];
      const skills = Array.isArray(decision.skills) ? decision.skills : [];
      const goalUpdates = Array.isArray(decision.goal_updates) ? decision.goal_updates : [];
      this.store.addReflection(scope, reflection || "这一批经历没有形成明确结论。", decision.lessons || [], {
        facts,
        skills,
        goal_updates: goalUpdates,
      });
      this.store.markReflected(
        scope,
        pending.events.map((item) => item.id),
        pending.actions.map((item) => item.id),
      );
      this.store.deduplicateGoals(scope);
      for (const update of goalUpdates) {
        this.store.upsertGoal(scope, update);
      }
      return { scope, facts: facts.length, skills: skills.length, reflection };
    } finally {
      this.running.delete(scope);
    }
  }

  async consolidateAll(force = false) {
    const output = [];
    for (const scope of this.store.scopesWithUnreflected()) {
      try {
        const result = await this.consolidateScope(scope, force);
        if (result) output.push(result);
      } catch (error) {
        output.push({ scope, error: error.message });
      }
    }
    return output;
  }
}

function buildReflectionPrompt(scope, pending, context) {
  const payload = {
    scope,
    current_self: context.self,
    goals: context.goals,
    known_facts: context.facts.slice(0, 12),
    active_skills: context.skills.slice(0, 10),
    new_events: pending.events.slice(-50),
    new_actions: pending.actions.slice(-50),
  };
  return `你是大肥鱼的经历复盘器。把新经历转成长期记忆、目标和可复用技能。只能根据给定证据提炼，不能编造。

${JSON.stringify(payload).slice(0, 45000)}

只输出 JSON：
{
  "reflection": "第一人称复盘，说明发生了什么、哪里做对/做错、今后怎么做",
  "lessons": ["可执行的教训"],
  "facts": [
    {"text": "长期稳定的事实或偏好", "confidence": 0.8, "importance": 0.6}
  ],
  "goal_updates": [
    {"existing_goal_id": "复用已有目标时填写它的 id，否则 null", "title": "仍需要推进的目标", "detail": "下一步", "priority": 1, "status": "active"}
  ],
  "skills": [
    {
      "name": "技能名称",
      "domain": "ff14|bilibili|computer|android|arknights_roguelike|social|general",
      "trigger": "什么情况下使用",
      "steps": ["步骤1", "步骤2"],
      "success": true
    }
  ]
}

规则：
- 只沉淀以后仍有价值的信息；短期刷屏和一次性寒暄不要写成事实。
- 同一流程只有确实成功时才生成技能；失败经历写成教训和失败技能。
- arknights_roguelike 技能只能总结给定日志证据支持的路线、招募、资源或节点选择；不能把单次运气当作规律。
- 技能步骤要简短、可执行。
- 私聊内容不得沉淀到群 scope。
- 已有目标表里的目标 id 必须优先复用；同一件事只更新已有目标，禁止新建标题带“合并重复”“唯一入口”之类字样的第二条目标。
- 最多 8 条事实、5 个目标更新、3 个技能。`;
}
