import { homedir } from "node:os";
import { resolve } from "node:path";
import { loadConfig } from "./config.mjs";
import { DshDecisionMaker, loadEnvironmentFiles } from "./dsh.mjs";
import { OneBotConnection } from "./onebot.mjs";
import {
  isDirectBotMention,
  normalizeDecision,
  proactiveMessages,
  validateDecision,
} from "./policy.mjs";
import { buildPrompt } from "./prompt.mjs";
import { SocialState } from "./state.mjs";
import { BrainClient } from "../shared/brain-client.mjs";

await loadEnvironmentFiles([".env", resolve(homedir(), ".dsh/.env")]);
const config = await loadConfig(process.env.BIGFISH_SOCIAL_CONFIG || "config/social.json");
const state = new SocialState(process.env.BIGFISH_STATE_PATH || "data/social/state.json");
await state.load();
const dsh = new DshDecisionMaker(config.dsh);
const brain = new BrainClient();
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
    const ambientMessages = proactiveMessages(group.messages, config.botQQ);
    if (ambientMessages.length === 0) {
      group.nextCheckAt = Date.now() + config.evaluation.heartbeatMs;
      await state.save();
      log(`group=${groupId} skipped proactive evaluation: direct chat owns the recent messages`);
      return;
    }
    const recentSenderIds = new Set(ambientMessages.slice(-40).map((item) => item.senderId));
    const scope = `group:${groupId}`;
    const brainContext = await brain.context(scope).catch(() => null);
    const prompt = buildPrompt({
      config,
      state: state.value,
      groupId,
      brainContext,
      messages: ambientMessages,
    });
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
    await brain.setSelf(scope, {
      mood: chosen.innerState?.mood,
      focus: chosen.innerState?.focus,
      desire: chosen.innerState?.desire,
    }).catch(() => null);
    state.value.self.lastThought = chosen.reason || "";
    for (const memory of chosen.memories) {
      if (!memory || typeof memory.content !== "string" || !memory.content.trim()) continue;
      const scope = typeof memory.scope === "string" && memory.scope ? memory.scope : `group:${groupId}`;
      state.remember(scope, memory.content);
      await brain.observe(scope, "memory_candidate", { content: memory.content }, true).catch(() => null);
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
      await brain.action(`group:${chosen.targetGroup}`, "proactive_group_message", {
        atQq: chosen.atQq,
        reason: chosen.reason,
      }, chosen.message, true).catch(() => null);
      log(`group=${chosen.targetGroup} proactive message sent: ${chosen.reason}`);
    } else if (chosen.action === "request_tool") {
      const approval = await brain.approval(scope, chosen.toolDomain, chosen.reason, {
        request: chosen.message,
        atQq: chosen.atQq,
      }).catch(() => null);
      const suffix = approval ? ` [申请 ${approval.id.slice(0, 8)}]` : "";
      await connection.sendGroup(chosen.targetGroup, `${chosen.message}${suffix}`, chosen.atQq);
      state.appendAction({
        type: "request_tool",
        groupId: chosen.targetGroup,
        message: chosen.message,
        reason: chosen.reason,
        at: Date.now(),
      });
      await brain.action(scope, "tool_permission_requested", {
        toolDomain: chosen.toolDomain,
        approvalId: approval?.id,
        atQq: chosen.atQq,
      }, `${chosen.message}${suffix}`, true).catch(() => null);
      await brain.goal(scope, `等待主人批准：${chosen.toolDomain}`, chosen.message, 2).catch(() => null);
      log(`group=${chosen.targetGroup} requested ${chosen.toolDomain} permission from owner`);
    } else {
      await brain.action(scope, "proactive_wait", {}, chosen.reason || "no action", true).catch(() => null);
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
    if (message.senderId === config.botQQ) {
      if (message.groupId && config.groups.includes(message.groupId)) {
        void brain.observe(`group:${message.groupId}`, "bot_group_message", {
          text: message.text,
        }, true).catch(() => null);
      }
      return;
    }
    if (message.groupId) {
      if (!config.groups.includes(message.groupId)) return;
      state.appendMessage(message.groupId, message);
      void brain.observe(`group:${message.groupId}`, "group_message", {
        senderId: message.senderId,
        senderName: message.senderName,
        text: message.text,
      }, true).catch(() => null);
      if (message.senderId === config.ownerQQ) void handleOwnerApproval(message);
      void state.save();
      // Direct @ messages are owned by the live DSH chat session. Running the
      // proactive decision loop on the same message created duplicate replies
      // and fake tool approvals while an async gameplay worker was active.
      if (!isDirectBotMention(message, config.botQQ)) {
        scheduleGroup(message.groupId, config.evaluation.debounceMs);
      }
      return;
    }
    if (config.privateAllowlist.includes(message.senderId) && message.text) {
      log(`private message from allowed contact ${message.senderId}; DSH QQ bridge handles direct replies`);
    }
  },
});

async function handleOwnerApproval(message) {
  const segments = Array.isArray(message.raw?.message) ? message.raw.message : [];
  const atBot = segments.some(
    (part) => part?.type === "at" && String(part?.data?.qq || "") === config.botQQ,
  );
  if (!atBot) return;
  const text = String(message.text || "").trim();
  const approved = /同意|可以|批准|允许|去吧|开吧|行/.test(text);
  const denied = /不同意|不可以|拒绝|不要|算了|别去/.test(text);
  if (!approved && !denied) return;
  const scope = `group:${message.groupId}`;
  const context = await brain.context(scope).catch(() => null);
  const pending = context?.approvals?.[0];
  if (!pending) return;
  const result = await brain.decideApproval(pending.id, approved).catch(() => null);
  if (result) {
    await brain.observe(scope, approved ? "tool_permission_approved" : "tool_permission_denied", {
      approvalId: pending.id,
      action: pending.action,
      ownerMessage: text,
    }, approved).catch(() => null);
    log(`tool approval ${pending.id.slice(0, 8)} ${approved ? "approved" : "denied"} by owner`);
  }
}

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
