const ACTIONS = new Set(["wait", "group_message", "private_message"]);

export function normalizeDecision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const action = ACTIONS.has(value.action) ? value.action : "wait";
  return {
    action,
    message: typeof value.message === "string" ? value.message.trim() : "",
    targetGroup: value.target_group == null ? "" : String(value.target_group),
    targetQq: value.target_qq == null ? "" : String(value.target_qq),
    atQq: value.at_qq == null ? "" : String(value.at_qq),
    reason: typeof value.reason === "string" ? value.reason.trim().slice(0, 800) : "",
    innerState: value.inner_state && typeof value.inner_state === "object" ? value.inner_state : {},
    memories: Array.isArray(value.memory) ? value.memory.slice(0, 5) : [],
    nextCheckMinutes: clampNumber(value.next_check_minutes, 2, 180, 10),
  };
}

export function isQuietHour(date, evaluation) {
  const hour = date.getHours();
  const start = evaluation.quietStartHour;
  const end = evaluation.quietEndHour;
  return start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

export function validateDecision(decision, context) {
  const { config, now = new Date(), groupId, state, recentSenderIds = new Set() } = context;
  const evaluation = config.evaluation;
  if (!decision) return { ok: true, decision: { action: "wait", reason: "invalid decision" } };
  if (decision.action === "wait") return { ok: true, decision };
  if (isQuietHour(now, evaluation)) return { ok: false, reason: "quiet-hours" };
  if (!decision.message) return { ok: false, reason: "empty-message" };
  if (decision.message.length > evaluation.maxMessageChars) return { ok: false, reason: "message-too-long" };

  const timestamp = now.getTime();
  const globalLast = Math.max(0, ...state.actions.map((item) => item.at || 0));
  if (timestamp - globalLast < evaluation.globalCooldownMs) return { ok: false, reason: "global-cooldown" };
  const group = groupId ? state.groups[groupId] : null;
  if (groupId && group && timestamp - (group.lastActionAt || 0) < evaluation.groupCooldownMs) {
    return { ok: false, reason: "group-cooldown" };
  }
  const lastHour = state.actions.filter((item) => timestamp - item.at < 3600000);
  if (lastHour.length >= evaluation.maxActionsPerHour) return { ok: false, reason: "hourly-limit" };

  const normalized = decision.message.replace(/\s+/g, "");
  const duplicate = state.actions.some(
    (item) => timestamp - item.at < 6 * 3600000 && String(item.message || "").replace(/\s+/g, "") === normalized,
  );
  if (duplicate) return { ok: false, reason: "duplicate-message" };

  if (decision.action === "group_message") {
    const target = decision.targetGroup || groupId;
    if (!config.groups.includes(target)) return { ok: false, reason: "group-not-allowed" };
    if (decision.atQq && !recentSenderIds.has(decision.atQq) && decision.atQq !== config.ownerQQ) {
      return { ok: false, reason: "mention-not-in-context" };
    }
    return { ok: true, decision: { ...decision, targetGroup: target } };
  }

  if (!config.privateAllowlist.includes(decision.targetQq)) return { ok: false, reason: "private-target-not-allowed" };
  return { ok: true, decision };
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback;
}
