import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { loadConfig } from "../sociald/config.mjs";
import { DshDecisionMaker, loadEnvironmentFiles } from "../sociald/dsh.mjs";
import { OneBotConnection } from "../sociald/onebot.mjs";
import { inspectMessage, isSimilarReply, normalizeFollowupDecision } from "./reply-window.mjs";
import { BrainClient } from "../shared/brain-client.mjs";

await loadEnvironmentFiles([".env", resolve(homedir(), ".dsh/.env")]);
const config = await loadConfig(process.env.BIGFISH_SOCIAL_CONFIG || "config/social.json");
const cfg = config.replyWindow;
const statePath = resolve(process.env.BIGFISH_REPLY_STATE_PATH || "data/reply/state.json");
const state = await loadState(statePath);
const dsh = new DshDecisionMaker(config.dsh);
const brain = new BrainClient();
const timers = new Map();
const evaluating = new Set();
let connection;
let stopping = false;

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function groupState(groupId) {
  state.groups[groupId] ||= {
    messages: [],
    pending: [],
    sessionId: "",
    windowUntil: 0,
    botSpokeAt: 0,
    lastFollowupAt: 0,
    sent: [],
  };
  return state.groups[groupId];
}

function appendMessage(group, message, self = false) {
  group.messages.push({
    at: message.at,
    senderId: message.senderId,
    senderName: self ? "大肥鱼" : message.senderName,
    text: message.text,
  });
  group.messages = group.messages.slice(-40);
}

function scheduleEvaluation(groupId, delay = cfg.delayMs) {
  if (!cfg.enabled || stopping) return;
  const previous = timers.get(groupId);
  if (previous) clearTimeout(previous);
  timers.set(
    groupId,
    setTimeout(() => {
      timers.delete(groupId);
      void evaluate(groupId);
    }, Math.max(1000, delay)),
  );
}

function cancelEvaluation(groupId) {
  const timer = timers.get(groupId);
  if (timer) clearTimeout(timer);
  timers.delete(groupId);
  const group = groupState(groupId);
  group.pending = [];
}

async function evaluate(groupId) {
  if (!cfg.enabled || stopping || evaluating.has(groupId)) return;
  const group = groupState(groupId);
  const now = Date.now();
  if (now >= group.windowUntil || !group.botSpokeAt || !group.pending.length) return;
  evaluating.add(groupId);
  try {
    const pending = group.pending.splice(0);
    const recent = group.messages.slice(-20)
      .map((item) => `${new Date(item.at).toLocaleTimeString("zh-CN", { hour12: false })} ${item.senderName}(${item.senderId}): ${item.text}`)
      .join("\n");
    const scope = `group:${groupId}`;
    const brainContext = await brain.context(scope).catch(() => null);
    const prompt = buildFollowupPrompt({ config, groupId, group, pending, recent, brainContext });
    const result = await dsh.decide({
      prompt,
      sessionId: group.sessionId || null,
      timeoutMs: config.dsh.timeoutMs,
    });
    if (result.sessionId) group.sessionId = result.sessionId;
    const decision = normalizeFollowupDecision(result.decision);
    if (!decision.shouldReply || !decision.content || decision.content.length > cfg.maxReplyChars) {
      await brain.action(scope, "reply_window_wait", { pending }, decision.reason || "no reply", true).catch(() => null);
      log(`group=${groupId} follow-up stayed silent: ${decision.reason || "no-reply"}`);
      return;
    }
    if (Date.now() >= group.windowUntil) return;
    if (group.sent.slice(-8).some((previous) => isSimilarReply(decision.content, previous))) {
      log(`group=${groupId} follow-up blocked as duplicate`);
      return;
    }
    await connection.sendGroup(groupId, decision.content);
    await brain.action(scope, "reply_window_followup", {
      pending,
      reason: decision.reason,
    }, decision.content, true).catch(() => null);
    group.sent.push(decision.content);
    group.sent = group.sent.slice(-12);
    group.lastFollowupAt = Date.now();
    log(`group=${groupId} follow-up sent: ${decision.reason || "context continuation"}`);
  } catch (error) {
    log(`group=${groupId} follow-up failed: ${error.message}`);
  } finally {
    evaluating.delete(groupId);
    await saveState();
  }
}

function buildFollowupPrompt({ config: app, groupId, group, pending, recent, brainContext }) {
  const goals = (brainContext?.goals || []).map((item) => `- ${item.title}`).join("\n");
  const facts = (brainContext?.facts || []).map((item) => `- ${item.text}`).join("\n");
  const skills = (brainContext?.skills || []).map((item) => `- ${item.name}: ${item.trigger}`).join("\n");
  const traits = Object.entries(brainContext?.self?.traits || {})
    .map(([trait, value]) => `- ${trait}: ${Number(value).toFixed(2)}`)
    .join("\n");
  return `你刚在 QQ 群 ${groupId} 回过话。现在是固定 60 秒接话窗口，只有窗口内的新文字能触发本次判断。

人格：
- ${app.persona.style}
- ${app.persona.boundaries.map((item) => `- ${item}`).join("\n")}

最近群聊：
${recent}

本次待判断的新文字：
${pending.map((item) => `${item.senderName}(${item.senderId}): ${item.text}`).join("\n")}

中枢目标：
${goals || "暂无"}

中枢长期事实：
${facts || "暂无"}

已进化的表达特质（只影响语气）：
${traits || "暂无"}

已形成技能：
${skills || "暂无"}

判断是否自然接一句。可以保持沉默；只有真正相关、有趣、能延续对话时才回复。纯表情或刷屏不应触发回复；点名别人或明显在和别人对话时保持沉默。普通搜索可以使用 'web_search' 调用 DeepSeek 搜索服务，但不能打开网页、看小说/漫画/视频，也不能使用浏览器、电脑、手机或 B站工具。回复不需要艾特人，直接像群友插一句。日常回复通常 5～25 字。

只输出 JSON：
{"should_reply": true, "content": "回复正文", "reason": "具体理由"}`;
}

connection = new OneBotConnection({
  url: config.onebot.url,
  token: process.env[config.onebot.tokenEnv] || "",
  onStatus(status) {
    log(`OneBot ${status.kind}${status.message ? `: ${status.message}` : ""}`);
  },
  onMessage(message) {
    if (!message.groupId || !config.groups.includes(message.groupId)) return;
    const group = groupState(message.groupId);
    const now = Date.now();
    const inspected = inspectMessage(message, config.botQQ);
    if (message.senderId === config.botQQ) {
      appendMessage(group, message, true);
      if (now < group.windowUntil) group.botSpokeAt = now;
      void saveState();
      return;
    }
    appendMessage(group, message);
    if (inspected.atBot) {
      cancelEvaluation(message.groupId);
      group.windowUntil = now + cfg.windowMs;
      group.botSpokeAt = 0;
      log(`group=${message.groupId} mention window opened for ${cfg.windowMs}ms`);
      void saveState();
      return;
    }
    if (now >= group.windowUntil) {
      void saveState();
      return;
    }
    if (inspected.atOther || inspected.hasReply) {
      cancelEvaluation(message.groupId);
      group.windowUntil = now;
      log(`group=${message.groupId} follow-up suspended: addressed elsewhere`);
      void saveState();
      return;
    }
    if (inspected.pureImage || !inspected.visibleText) {
      void saveState();
      return;
    }
    if (!group.botSpokeAt) {
      void saveState();
      return;
    }
    group.pending.push({
      at: now,
      senderId: message.senderId,
      senderName: message.senderName,
      text: inspected.visibleText,
    });
    group.pending = group.pending.slice(-12);
    scheduleEvaluation(message.groupId, cfg.delayMs);
    void saveState();
  },
});

connection.connect();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
function shutdown() {
  stopping = true;
  for (const timer of timers.values()) clearTimeout(timer);
  connection.close();
  log("reply window daemon stopped");
  setTimeout(() => process.exit(0), 100);
}

async function loadState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, groups: {} };
  }
}

async function saveState() {
  await mkdir(dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, statePath);
}

log(`reply window daemon started; enabled=${cfg.enabled}; profile=${config.dsh.profile}`);
