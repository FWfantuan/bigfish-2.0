import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

function now() {
  return new Date().toISOString();
}

function json(value, fallback) {
  try {
    return value == null ? fallback : JSON.parse(value);
  } catch {
    return fallback;
  }
}

function canonicalSkillKey(item) {
  return `${item.domain || "general"}|${item.name || ""}|${item.trigger || ""}`
    .toLowerCase()
    .replace(/[^\p{L}\p{N}|]+/gu, "")
    .slice(0, 500);
}

function skillPromotionPolicy(domain) {
  return domain === "arknights_roguelike"
    ? { minimumEvidence: 5, minimumSuccessRate: 0.6, minimumSuccesses: 3 }
    : { minimumEvidence: 2, minimumSuccessRate: 0, minimumSuccesses: 0 };
}

export function canonicalGoalKey(title) {
  let value = String(title || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  value = value.replace(/^合并重复(?:目标)?[：:\s_-]*/u, "");
  value = value.replace(/[（(][^）)]*(?:合并重复|唯一入口)[^）)]*[）)]/gu, "");
  value = value.replace(/(?:合并重复(?:目标)?|唯一入口)/gu, "");
  return value.replace(/[^\p{L}\p{N}]+/gu, "").slice(0, 600);
}

export function goalsEquivalent(left, right) {
  const a = canonicalGoalKey(left);
  const b = canonicalGoalKey(right);
  if (!a || !b) return false;
  if (a === b) return true;
  const topicA = goalTopicText(a);
  const topicB = goalTopicText(b);
  if (topicA && topicB) {
    if (topicA === topicB) return true;
    if (topicA.length <= 2 && topicB.includes(topicA) || topicB.length <= 2 && topicA.includes(topicB)) return true;
    if (goalBigramSimilarity(topicA, topicB) >= 0.45) return true;
  }
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length > b.length ? a : b;
  return shorter.length >= 8 && longer.includes(shorter);
}

function goalTopicText(value) {
  return value
    .replace(/跟进|验证|检查|确认|问清|说清|回应|处理|推进|修好|修复|合并|重复|目标|主人|大肥鱼|群内|群里|全群|所有群友|通道|可见|最后|那个|这个|那些|这些|什么|怎么|如何|一下|继续/gu, "")
    .replace(/beta/gu, "")
    .replace(/^(并|和|与|再|去|把|给|让)+|(并|和|与|再|去|把|给|让)+$/gu, "");
}

function goalBigramSimilarity(left, right) {
  const grams = (value) => {
    const chars = [...value];
    if (chars.length < 2) return new Set(chars);
    return new Set(chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`));
  };
  const a = grams(left);
  const b = grams(right);
  if (a.size === 0 || b.size === 0) return 0;
  let overlap = 0;
  for (const value of a) {
    if (b.has(value)) overlap += 1;
  }
  return (2 * overlap) / (a.size + b.size);
}

export class BrainStore {
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS self_state (
        scope TEXT PRIMARY KEY, mood TEXT NOT NULL DEFAULT '', focus TEXT NOT NULL DEFAULT '',
        desires_json TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL, content_json TEXT NOT NULL,
        success INTEGER NOT NULL DEFAULT 1, reflected INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_scope_time ON events(scope, created_at DESC);
      CREATE TABLE IF NOT EXISTS facts (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, text TEXT NOT NULL, confidence REAL NOT NULL DEFAULT 0.7,
        importance REAL NOT NULL DEFAULT 0.5, source TEXT NOT NULL, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL, UNIQUE(scope, text)
      );
      CREATE INDEX IF NOT EXISTS facts_scope_rank ON facts(scope, importance DESC, confidence DESC);
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
        priority INTEGER NOT NULL DEFAULT 3, status TEXT NOT NULL DEFAULT 'active',
        due_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS goals_scope_status ON goals(scope, status, priority DESC, updated_at DESC);
      CREATE TABLE IF NOT EXISTS actions (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, kind TEXT NOT NULL, goal_id TEXT,
        payload_json TEXT NOT NULL, result TEXT NOT NULL DEFAULT '', success INTEGER NOT NULL DEFAULT 1,
        reflected INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS actions_scope_time ON actions(scope, created_at DESC);
      CREATE TABLE IF NOT EXISTS reflections (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, summary TEXT NOT NULL, lessons_json TEXT NOT NULL DEFAULT '[]',
        source_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS reflections_scope_time ON reflections(scope, created_at DESC);
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY, skill_key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, domain TEXT NOT NULL,
        trigger TEXT NOT NULL, steps_json TEXT NOT NULL, evidence_count INTEGER NOT NULL DEFAULT 1,
        success_count INTEGER NOT NULL DEFAULT 0, failure_count INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'candidate', last_used_at TEXT, created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS approvals (
        id TEXT PRIMARY KEY, scope TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL,
        payload_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL, decided_at TEXT
      );
    `);
  }

  close() {
    this.db.close();
  }

  setSelf(scope, update) {
    const previous = this.getSelf(scope);
    const mood = String(update.mood ?? previous.mood ?? "").slice(0, 500);
    const focus = String(update.focus ?? previous.focus ?? "").slice(0, 1000);
    const desires = Array.isArray(update.desires)
      ? update.desires.map(String).slice(0, 20)
      : update.desire
        ? [String(update.desire)]
        : previous.desires;
    const stamp = now();
    this.db.prepare(`
      INSERT INTO self_state(scope,mood,focus,desires_json,updated_at) VALUES (?,?,?,?,?)
      ON CONFLICT(scope) DO UPDATE SET mood=excluded.mood,focus=excluded.focus,
      desires_json=excluded.desires_json,updated_at=excluded.updated_at
    `).run(scope, mood, focus, JSON.stringify(desires), stamp);
    return this.getSelf(scope);
  }

  getSelf(scope) {
    const row = this.db.prepare("SELECT * FROM self_state WHERE scope=?").get(scope);
    if (!row) return { mood: "curious", focus: "", desires: [], updatedAt: null };
    return { mood: row.mood, focus: row.focus, desires: json(row.desires_json, []), updatedAt: row.updated_at };
  }

  addEvent(scope, kind, content, success = true) {
    const item = {
      id: randomUUID(), scope, kind: String(kind).slice(0, 120), content, success: Boolean(success),
      createdAt: now(),
    };
    this.db.prepare(
      "INSERT INTO events(id,scope,kind,content_json,success,reflected,created_at) VALUES (?,?,?,?,?,0,?)",
    ).run(item.id, item.scope, item.kind, JSON.stringify(content), success ? 1 : 0, item.createdAt);
    return item;
  }

  addAction(scope, kind, payload, result, success = true, goalId = null) {
    const item = {
      id: randomUUID(), scope, kind: String(kind).slice(0, 120), goalId,
      payload, result: String(result).slice(0, 12000), success: Boolean(success), createdAt: now(),
    };
    this.db.prepare(`
      INSERT INTO actions(id,scope,kind,goal_id,payload_json,result,success,reflected,created_at)
      VALUES (?,?,?,?,?,?,?,0,?)
    `).run(item.id, scope, item.kind, goalId, JSON.stringify(payload), item.result, success ? 1 : 0, item.createdAt);
    return item;
  }

  addFact(scope, text, { confidence = 0.7, importance = 0.5, source = "reflection" } = {}) {
    const clean = String(text || "").trim().slice(0, 4000);
    if (!clean) return null;
    const stamp = now();
    this.db.prepare(`
      INSERT INTO facts(id,scope,text,confidence,importance,source,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?)
      ON CONFLICT(scope,text) DO UPDATE SET confidence=MAX(confidence,excluded.confidence),
      importance=MAX(importance,excluded.importance),updated_at=excluded.updated_at
    `).run(randomUUID(), scope, clean, Number(confidence) || 0.7, Number(importance) || 0.5, source, stamp, stamp);
    return { scope, text: clean };
  }

  replaceFacts(scope, source, facts = []) {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM facts WHERE scope=? AND source=?").run(scope, source);
      for (const fact of facts) {
        this.addFact(scope, fact.text, { ...fact, source });
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.facts(scope, 50).filter((fact) => fact.source === source);
  }

  createGoal(scope, title, detail = "", priority = 3, dueAt = null) {
    const stamp = now();
    const item = { id: randomUUID(), scope, title: String(title).slice(0, 500), detail: String(detail).slice(0, 4000), priority, status: "active", dueAt, createdAt: stamp, updatedAt: stamp };
    this.db.prepare(`
      INSERT INTO goals(id,scope,title,detail,priority,status,due_at,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?)
    `).run(item.id, scope, item.title, item.detail, priority, "active", dueAt, stamp, stamp);
    return item;
  }

  upsertGoal(scope, update = {}) {
    const title = String(update.title || "").trim();
    if (!title) return null;
    const existingGoals = this.goals(scope, "", 200);
    const requested = update.existing_goal_id
      ? existingGoals.find((goal) => goal.id === update.existing_goal_id)
      : undefined;
    const matched = requested || existingGoals.find((goal) => goalsEquivalent(goal.title, title));
    if (!matched) {
      return this.createGoal(
        scope,
        title,
        update.detail || "",
        Number(update.priority || 3),
        update.dueAt || null,
      );
    }

    const updated = this.updateGoal(matched.id, {
      title,
      detail: update.detail ?? matched.detail,
      priority: update.priority ?? matched.priority,
      status: update.status ?? matched.status,
    });
    for (const duplicate of existingGoals) {
      if (duplicate.id === matched.id || duplicate.status !== "active") continue;
      if (!goalsEquivalent(duplicate.title, matched.title) && !goalsEquivalent(duplicate.title, title)) continue;
      this.updateGoal(duplicate.id, {
        status: "completed",
        detail: `${duplicate.detail}\n[已合并到目标：${title}]`,
      });
    }
    return updated;
  }

  deduplicateGoals(scope) {
    const active = this.goals(scope, "active", 200);
    const kept = [];
    let merged = 0;
    for (const goal of active) {
      const target = kept.find((candidate) => goalsEquivalent(candidate.title, goal.title));
      if (!target) {
        kept.push(goal);
        continue;
      }
      const preferred = Number(goal.priority) > Number(target.priority)
        || (Number(goal.priority) === Number(target.priority) && goal.updatedAt > target.updatedAt)
        ? goal
        : target;
      const retired = preferred.id === target.id ? goal : target;
      this.updateGoal(retired.id, {
        status: "completed",
        detail: `${retired.detail}\n[已合并到目标：${preferred.title}]`,
      });
      const index = kept.indexOf(target);
      kept[index] = preferred;
      merged += 1;
    }
    return { scope, merged, remaining: kept.length };
  }

  updateGoal(id, update) {
    const current = this.db.prepare("SELECT * FROM goals WHERE id=?").get(id);
    if (!current) return null;
    const title = update.title ?? current.title;
    const detail = update.detail ?? current.detail;
    const priority = Number(update.priority ?? current.priority);
    const status = update.status ?? current.status;
    const dueAt = update.dueAt ?? current.due_at;
    this.db.prepare("UPDATE goals SET title=?,detail=?,priority=?,status=?,due_at=?,updated_at=? WHERE id=?")
      .run(title, detail, priority, status, dueAt, now(), id);
    return this.db.prepare("SELECT * FROM goals WHERE id=?").get(id);
  }

  goals(scope, status = "active", limit = 20) {
    return this.db.prepare(`
      SELECT id,title,detail,priority,status,due_at AS dueAt,created_at AS createdAt,updated_at AS updatedAt
      FROM goals WHERE scope=? AND (?='' OR status=?) ORDER BY priority DESC,updated_at DESC LIMIT ?
    `).all(scope, status, status, limit);
  }

  facts(scope, limit = 20) {
    return this.db.prepare(`
      SELECT text,confidence,importance,source,updated_at AS updatedAt FROM facts
      WHERE scope=? ORDER BY importance DESC,confidence DESC,updated_at DESC LIMIT ?
    `).all(scope, limit);
  }

  recentEvents(scope, limit = 30) {
    return this.db.prepare("SELECT * FROM events WHERE scope=? ORDER BY created_at DESC LIMIT ?")
      .all(scope, limit)
      .map((row) => ({ ...row, content: json(row.content_json, {}), success: Boolean(row.success) }));
  }

  recentActions(scope, limit = 12) {
    return this.db.prepare("SELECT * FROM actions WHERE scope=? ORDER BY created_at DESC LIMIT ?")
      .all(scope, limit)
      .map((row) => ({
        kind: row.kind,
        payload: json(row.payload_json, {}),
        result: row.result,
        success: Boolean(row.success),
        createdAt: row.created_at,
      }));
  }

  unreflected(scope, eventLimit = 80, actionLimit = 80) {
    const events = this.db.prepare("SELECT * FROM events WHERE scope=? AND reflected=0 ORDER BY created_at LIMIT ?")
      .all(scope, eventLimit)
      .map((row) => ({ id: row.id, kind: row.kind, content: json(row.content_json, {}), success: Boolean(row.success), createdAt: row.created_at }));
    const actions = this.db.prepare("SELECT * FROM actions WHERE scope=? AND reflected=0 ORDER BY created_at LIMIT ?")
      .all(scope, actionLimit)
      .map((row) => ({ id: row.id, kind: row.kind, payload: json(row.payload_json, {}), result: row.result, success: Boolean(row.success), createdAt: row.created_at }));
    return { events, actions };
  }

  markReflected(scope, eventIds, actionIds) {
    this.db.exec("BEGIN");
    try {
      const eventStmt = this.db.prepare("UPDATE events SET reflected=1 WHERE scope=? AND id=?");
      const actionStmt = this.db.prepare("UPDATE actions SET reflected=1 WHERE scope=? AND id=?");
      for (const id of eventIds) eventStmt.run(scope, id);
      for (const id of actionIds) actionStmt.run(scope, id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  addReflection(scope, summary, lessons = [], source = {}) {
    const item = { id: randomUUID(), scope, summary: String(summary).slice(0, 8000), lessons, source, createdAt: now() };
    this.db.prepare("INSERT INTO reflections(id,scope,summary,lessons_json,source_json,created_at) VALUES (?,?,?,?,?,?)")
      .run(item.id, scope, item.summary, JSON.stringify(lessons), JSON.stringify(source), item.createdAt);
    for (const fact of source.facts || []) this.addFact(scope, fact.text, fact);
    for (const skill of source.skills || []) this.upsertSkill(scope, skill);
    return item;
  }

  reflections(scope, limit = 8) {
    return this.db.prepare("SELECT * FROM reflections WHERE scope=? ORDER BY created_at DESC LIMIT ?")
      .all(scope, limit)
      .map((row) => ({ ...row, lessons: json(row.lessons_json, []), source: json(row.source_json, {}) }));
  }

  upsertSkill(scope, skill) {
    const name = String(skill.name || "").trim().slice(0, 180);
    const domain = String(skill.domain || "general").trim().slice(0, 100);
    const trigger = String(skill.trigger || "").trim().slice(0, 1000);
    const steps = Array.isArray(skill.steps) ? skill.steps.map(String).slice(0, 30) : [];
    if (!name || !trigger || !steps.length) return null;
    const key = `${scope}|${canonicalSkillKey({ name, domain, trigger })}`;
    const stamp = now();
    const existing = this.db.prepare("SELECT * FROM skills WHERE skill_key=?").get(key);
    if (existing) {
      const evidence = existing.evidence_count + 1;
      const success = existing.success_count + (skill.success === false ? 0 : 1);
      const failure = existing.failure_count + (skill.success === false ? 1 : 0);
      const policy = skillPromotionPolicy(domain);
      const successRate = evidence > 0 ? success / evidence : 0;
      const status = evidence >= policy.minimumEvidence
          && success >= policy.minimumSuccesses
          && successRate >= policy.minimumSuccessRate
        ? "active"
        : evidence >= policy.minimumEvidence
          && successRate < policy.minimumSuccessRate
          ? "retired"
          : "candidate";
      this.db.prepare(`
        UPDATE skills SET steps_json=?,evidence_count=?,success_count=?,failure_count=?,status=?,updated_at=?
        WHERE skill_key=?
      `).run(JSON.stringify(steps), evidence, success, failure, status, stamp, key);
      return this.db.prepare("SELECT * FROM skills WHERE skill_key=?").get(key);
    }
    const item = {
      id: randomUUID(), key, name, domain, trigger, steps, evidence: 1, success: skill.success === false ? 0 : 1,
      failure: skill.success === false ? 1 : 0, status: "candidate", stamp,
    };
    this.db.prepare(`
      INSERT INTO skills(id,skill_key,name,domain,trigger,steps_json,evidence_count,success_count,failure_count,status,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(item.id, item.key, name, domain, trigger, JSON.stringify(steps), item.evidence, item.success, item.failure, item.status, stamp, stamp);
    return this.db.prepare("SELECT * FROM skills WHERE skill_key=?").get(key);
  }

  skills(scope, activeOnly = true) {
    const rows = this.db.prepare("SELECT * FROM skills WHERE skill_key LIKE ? ORDER BY evidence_count DESC,updated_at DESC LIMIT 30")
      .all(`${scope}|%`);
    return rows
      .filter((row) => !activeOnly || row.status === "active")
      .map((row) => ({ ...row, steps: json(row.steps_json, []) }));
  }

  createApproval(scope, action, reason, payload = {}) {
    const item = { id: randomUUID(), scope, action: String(action).slice(0, 500), reason: String(reason).slice(0, 2000), payload, status: "pending", createdAt: now() };
    this.db.prepare("INSERT INTO approvals(id,scope,action,reason,payload_json,status,created_at) VALUES (?,?,?,?,?,?,?)")
      .run(item.id, scope, item.action, item.reason, JSON.stringify(payload), "pending", item.createdAt);
    return item;
  }

  decideApproval(id, approved) {
    this.db.prepare("UPDATE approvals SET status=?,decided_at=? WHERE id=? AND status='pending'")
      .run(approved ? "approved" : "denied", now(), id);
    const row = this.db.prepare("SELECT * FROM approvals WHERE id=?").get(id);
    return row ? { ...row, payload: json(row.payload_json, {}) } : null;
  }

  approvals(scope, status = "pending") {
    return this.db.prepare("SELECT * FROM approvals WHERE scope=? AND (?='' OR status=?) ORDER BY created_at DESC LIMIT 40")
      .all(scope, status, status)
      .map((row) => ({ ...row, payload: json(row.payload_json, {}) }));
  }

  context(scope) {
    return {
      scope,
      self: this.getSelf(scope),
      goals: this.goals(scope),
      facts: this.facts(scope),
      recentEvents: this.recentEvents(scope, 12),
      recentActions: this.recentActions(scope, 12),
      reflections: this.reflections(scope, 5).map(({ summary, lessons, created_at }) => ({ summary, lessons, createdAt: created_at })),
      skills: this.skills(scope),
      approvals: this.approvals(scope, "pending"),
    };
  }

  scopesWithUnreflected() {
    return this.db.prepare(`
      SELECT scope FROM (
        SELECT scope FROM events WHERE reflected=0
        UNION ALL SELECT scope FROM actions WHERE reflected=0
      ) GROUP BY scope
    `).all().map((row) => row.scope);
  }

  allGoalScopes() {
    return this.db.prepare("SELECT DISTINCT scope FROM goals").all().map((row) => row.scope);
  }
}
