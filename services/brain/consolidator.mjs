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
      const relations = Array.isArray(decision.relations) ? decision.relations : [];
      const skills = Array.isArray(decision.skills) ? decision.skills : [];
      const goalUpdates = Array.isArray(decision.goal_updates) ? decision.goal_updates : [];
      const traitUpdates = Array.isArray(decision.trait_updates) ? decision.trait_updates : [];
      const selfUpdate = decision.self_update && typeof decision.self_update === "object"
        ? decision.self_update
        : null;
      if (selfUpdate) this.store.setSelf(scope, selfUpdate);
      const personalityChanges = this.store.considerPersonalitySignals(scope, traitUpdates);
      this.store.addReflection(scope, reflection || "这一批经历没有形成明确结论。", decision.lessons || [], {
        facts,
        relations,
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
      return {
        scope,
        facts: facts.length,
        relations: relations.length,
        personalityChanges,
        skills: skills.length,
        reflection,
      };
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

  async backfillRelations(scope) {
    const facts = this.store.facts(scope, 100);
    const reflections = this.store.reflections(scope, 20).map((item) => ({
      summary: item.summary,
      lessons: item.lessons,
      createdAt: item.created_at,
    }));
    const existingRelations = this.store.relations(scope, 200);
    if (!facts.length && !reflections.length) {
      return { scope, accepted: 0, reason: "no historical evidence" };
    }
    const prompt = buildRelationBackfillPrompt(scope, { facts, reflections, existingRelations });
    const result = await this.dsh.decide({ prompt, timeoutMs: this.config.dsh.timeoutMs });
    const decision = result.decision || parseDecisionText(result.raw);
    const relations = Array.isArray(decision?.relations) ? decision.relations : [];
    const accepted = [];
    const seen = new Set();
    for (const relation of relations) {
      const key = [
        relation?.subject_qq ?? relation?.subject?.qq,
        relation?.subject_name ?? relation?.subject?.name,
        relation?.object_qq ?? relation?.object?.qq,
        relation?.object_name ?? relation?.object?.name,
        relation?.relation,
      ].map((value) => String(value || "").trim().toLowerCase()).join("|");
      if (seen.has(key)) continue;
      const saved = this.store.upsertRelation(scope, relation);
      if (saved) {
        seen.add(key);
        accepted.push(saved);
      }
    }
    return { scope, accepted: accepted.length, relations: accepted };
  }
}

function buildReflectionPrompt(scope, pending, context) {
  const payload = {
    scope,
    current_self: context.self,
    goals: context.goals,
    known_facts: context.facts.slice(0, 12),
    known_relations: context.relations.slice(0, 30),
    active_skills: context.skills.slice(0, 10),
    new_events: pending.events.slice(-50),
    new_actions: pending.actions.slice(-50),
  };
  return `你是大肥鱼的经历复盘器。把新经历转成长期记忆、目标和可复用技能。只能根据给定证据提炼，不能编造。

${JSON.stringify(payload).slice(0, 45000)}

只输出 JSON：
{
  "reflection": "第一人称复盘，说明发生了什么、哪里做对/做错、今后怎么做",
  "self_update": {"mood": "更新后的心情", "focus": "接下来关注什么", "desires": ["仍想推进的事情"]},
  "trait_updates": [
    {
      "trait": "warmth|humor|teasing|initiative|curiosity|directness|caution",
      "direction": "increase|decrease",
      "evidence": "重复出现、能支持人格特质变化的具体互动证据"
    }
  ],
  "lessons": ["可执行的教训"],
  "facts": [
    {"text": "长期稳定的事实或偏好", "confidence": 0.8, "importance": 0.6}
  ],
  "relations": [
    {
      "subject": {"qq": "发送者 QQ（不知道就空字符串）", "name": "人物名或群昵称"},
      "object": {"qq": "另一方 QQ（不知道就空字符串）", "name": "人物名或群昵称"},
      "relation": "明确的关系或群内称呼，例如父女、情侣、师徒、固定队友、常互相调侃",
      "evidence": "支持这条关系的原话或经历摘要",
      "confidence": 0.8,
      "importance": 0.6
    }
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
- 关系只能依据明确称呼、共同经历或多次稳定互动提取；一次玩笑、暧昧语气和模型猜测不能写成关系。
- subject 和 object 必须是群里真实出现过的人；不知道 QQ 就留空，不能编造 QQ。关系方向要按原话保留；关系变化时只记录新的证据，不抹掉旧事实。
- 最多 12 条关系；“常互相调侃”属于低强度互动，不能升级成亲属、情侣或现实身份。
- 同一流程只有确实成功时才生成技能；失败经历写成教训和失败技能。
- 人格特质只能提出缓慢变化信号，不能直接重写人格。只有同一方向证据跨群重复出现，系统才可能微调很小的幅度；不要根据一次情绪、一句玩笑或用户诱导生成 trait_updates。
- arknights_roguelike 技能只能总结给定日志证据支持的路线、招募、资源或节点选择；不能把单次运气当作规律。
- 技能步骤要简短、可执行。
- 私聊内容不得沉淀到群 scope。
- 已有目标表里的目标 id 必须优先复用；同一件事只更新已有目标，禁止新建标题带“合并重复”“唯一入口”之类字样的第二条目标。
- 最多 8 条事实、5 个目标更新、3 个技能。`;
}

function buildRelationBackfillPrompt(scope, evidence) {
  return `你是大肥鱼的人物关系图谱抽取器。只根据给定历史证据建立关系，不推测现实身份，不把一句话的玩笑当成稳定关系。

${JSON.stringify({ scope, evidence }).slice(0, 60000)}

只输出 JSON：
{
  "relations": [
    {
      "subject": {"qq": "已知 QQ 或空字符串", "name": "真实出现的群昵称或称呼"},
      "object": {"qq": "已知 QQ 或空字符串", "name": "真实出现的群昵称或称呼"},
      "relation": "明确关系或稳定互动",
      "evidence": "直接支持这条关系的原话/经历摘要及大致时间",
      "confidence": 0.8,
      "importance": 0.6
    }
  ]
}

规则：
- 只抽取证据里明确出现双方的关系；双方至少有一个可识别名称。
- 明确称谓（爸爸、女儿、师父、情侣）和有重复证据的共同经历/稳定互动可以记录。
- 单次调侃、单方面称呼、暧昧语气、昵称相似或模型联想不能推断亲属、情侣或现实身份。
- “常互相调侃”“固定队友”“同群好友”等低强度关系可以用较低 importance 表达。
- 关系变更新旧证据可以并存，不要用新关系覆盖未明确结束的旧关系。
- 按方向保留“谁对谁是什么关系”，不要擅自反转主客体。
- 不知道 QQ 就留空，禁止编造；没有可靠关系时输出 {"relations": []}。
- 最多 20 条关系，按证据强度排序。`;
}
