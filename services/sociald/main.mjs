import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "./config.mjs";
import { DshDecisionMaker, loadEnvironmentFiles } from "./dsh.mjs";
import { OneBotConnection } from "./onebot.mjs";
import { normalizeDecision, validateDecision } from "./policy.mjs";
import { buildPrompt } from "./prompt.mjs";
import { SocialState } from "./state.mjs";

const config = await loadConfig(process.env.BIGFISH_SOCIAL_CONFIG || "config/social.json");
await loadEnvironmentFiles([".env", resolve(homedir(), ".dsh/.env")]);
const state = new SocialState(process.env.BIGFISH_STATE_PATH || "data/social/state.json");
await state.load();
const dsh = new DshDecisionMaker(config.dsh);
const debounceTimers = new Map();
const evaluating = new Set();
let stopping = false;
let connection;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function scheduleGroup(groupId, delay) {
  if (!config.enabled || stopping) return;
  const previous = debounceTimers.get(groupId);
  if (previous) clearTimeout(previous);
  debounceTimers.set(
    groupId,
    setTimeout(() => {
      debounceTimers.delete(groupId);
      void evaluateGroup(groupId);
    }, Math.max(1000, delay)),
  );
}

async function evaluateGroup(groupId) {
  if (!config.enabled || stopping || evaluating.has(groupId)) return;
  const group = state.group(groupId);
  if (!group.messages.length) return;
  const now = Date.now();
  if (now < (group.nextCheckAt || 0)) {
    scheduleGroup(groupId, group.nextCheckAt - now);
    return;
  }
  evaluating.add(groupId);
  try {
    group.lastEvaluatedAt = now;
    const recentSenderIds = new Set(group.messages.slice(-40).map((item) => item.senderId));
    const prompt = buildPrompt({ config, state: state.value, groupId });
    const result = await dsh.decide({ prompt, sessionId: group.sessionId, timeoutMs: config.dsh.timeoutMs });
    if (result.sessionId) group.sessionId = result.sessionId;
    const decision = normalizeDecision(result.decision);
    if (!decision) {
      log(`group=${groupId} invalid decision; staying silent`);
      group.nextCheckAt = Date.now() + config.evaluation.heartbeatMs;
      await state.save();
      return;
    }

    const verdict = validateDecision(decision, { config, groupId, state: state.value, recentSenderIds });
    if (!verdict.ok) {
      log(`group=${groupId} action blocked: ${verdict.reason}`);
      group.nextCheckAt = Date.now() + config.evaluation.heartbeatMs;
      await state.save();
      return;
    }

    const chosen = verdict.decision;
    state.updateSelf(chosen.innerState);
    state.value.self.lastThought = chosen.reason || "";
    for (const memory of chosen.memories) {
      if (!memory || typeof memory.content !== "string" || !memory.content.trim()) continue;
      const scope = typeof memory.scope === "string" && memory.scope ? memory.scope : `group:${groupId}`;
      state.remember(scope, memory.content);
    }
    group.nextCheckAt =
      Date.now() + Math.max(chosen.nextCheckMinutes * 60000, config.evaluation.minEvaluationIntervalMs);

    if (chosen.action === "group_message") {
      await connection.sendGroup(chosen.targetGroup, chosen.message, chosen.atQq || null);
      state.appendAction({
        type: "group_message",
        groupId: chosen.targetGroup,
        message: chosen.message,
        reason: chosen.reason,
        at: Date.now(),
      });
      log(`group=${chosen.targetGroup} proactive message sent: ${chosen.reason}`);
    } else if (chosen.action === "private_message") {
      await connection.sendPrivate(chosen.targetQq, chosen.message);
      state.appendAction({
        type: "private_message",
        targetQq: chosen.targetQq,
        message: chosen.message,
        reason: chosen.reason,
        at: Date.now(),
      });
      log(`private target=${chosen.targetQq} proactive message sent: ${chosen.reason}`);
    } else {
      log(`group=${groupId} chose to wait: ${chosen.reason || "no reason"}`);
    }
    await state.save();
  } catch (error) {
    log(`group=${groupId} evaluation failed: ${error.message}`);
    group.nextCheckAt = Date.now() + Math.min(config.evaluation.heartbeatMs, 600000);
    await state.save();
  } finally {
    evaluating.delete(groupId);
  }
}

connection = new OneBotConnection({
  url: config.onebot.url,
  token: process.env[config.onebot.tokenEnv] || "",
  onStatus(status) {
    log(`OneBot ${status.kind}${status.message ? `: ${status.message}` : ""}`);
  },
  onMessage(message) {
    if (message.senderId === config.botQQ) return;
    if (message.groupId) {
      if (!config.groups.includes(message.groupId)) return;
      state.appendMessage(message.groupId, message);
      scheduleGroup(message.groupId, config.evaluation.debounceMs);
      void state.save();
      return;
    }
    if (config.privateAllowlist.includes(message.senderId) && message.text) {
      log(`private message from allowed contact ${message.senderId}; DSH QQ bridge handles direct replies`);
    }
  },
});

connection.connect();
setInterval(() => {
  if (!config.enabled || stopping) return;
  for (const groupId of config.groups) {
    const group = state.group(groupId);
    if (Date.now() >= (group.nextCheckAt || 0)) void evaluateGroup(groupId);
  }
}, Math.min(60000, Math.max(10000, config.evaluation.heartbeatMs / 2))).unref();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
function shutdown() {
  stopping = true;
  for (const timer of debounceTimers.values()) clearTimeout(timer);
  connection.close();
  log("social daemon stopped");
  setTimeout(() => process.exit(0), 100);
}

log(`social daemon started; enabled=${config.enabled}; profile=${config.dsh.profile}`);
