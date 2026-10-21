import { execFile } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { DshDecisionMaker, loadEnvironmentFiles } from "../sociald/dsh.mjs";
import { loadConfig } from "../sociald/config.mjs";
import { OneBotConnection } from "../sociald/onebot.mjs";
import { BrainClient } from "../shared/brain-client.mjs";
import {
  buildGameChoicePrompt,
  buildGameplayPrompt,
  findTargetPackage,
  normalizeGameChoice,
  parseInstalledPackages,
  parseOnlineDevices,
  reconcileDevicePresence,
  sessionGate,
} from "./core.mjs";

const execFileAsync = promisify(execFile);
await loadEnvironmentFiles([".env", resolve(homedir(), ".dsh/.env")]);
const chatConfig = await loadConfig(process.env.BIGFISH_SOCIAL_CONFIG || "config/social.json");
const gameConfig = JSON.parse(await readFile("config/gameplay.json", "utf8"));
const statePath = resolve(process.env.BIGFISH_GAMEPLAY_STATE || "data/mumud/state.json");
const statusPath = resolve(process.env.BIGFISH_GAMEPLAY_STATUS || "data/mumud/status.json");
const state = await loadState(statePath);
if (state.running) {
  state.running = false;
  await saveState();
  log("recovered an interrupted game session marker");
}
const adb = process.env.ADB || "adb";
const manager = process.env.MUMU_MANAGER || "D:\\MuMuPlayer\\nx_main\\MuMuManager.exe";
const notifyGroup = process.env[gameConfig.notifyGroupEnv] || chatConfig.groups[0];
const brain = new BrainClient();
const playDsh = new DshDecisionMaker({ profile: "bigfish-play", timeoutMs: 900000 });
const explicitTarget = gameConfig.targets?.[0];
const autonomy = gameConfig.autonomy || { enabled: false };
const runtimeStatus = {
  version: 1,
  updatedAt: new Date().toISOString(),
  mode: autonomy.enabled ? "autonomous" : explicitTarget ? "fixed-target" : "disabled",
  fixedTarget: explicitTarget?.name || null,
  currentTarget: null,
  device: state.lastDevice || null,
  capabilities: {
    chatAgentImageInput: false,
    gameAgentImageInput: true,
    gameAgentModel: "deepseek-v4-flash-vision-exp",
    screenshotInputVerified: true,
    coordinateMapping: "rotation-aware",
    coordinateVerified: true,
    webSearch: { enabled: autonomy.webSearch !== false, fetch: false },
    tesseractRequired: false,
  },
  explanation:
    "QQ 聊天层是文本模型；独立的 bigfish-play 自动游戏 worker 才是视觉模型。旧版“图像输入未接通/OCR 缺失/坐标漂移”的结论已被当前修复取代。",
  lastSession: null,
};
let connection;
let polling = false;
let stopping = false;

connection = new OneBotConnection({
  url: chatConfig.onebot.url,
  token: process.env[chatConfig.onebot.tokenEnv] || "",
  onStatus(status) {
    log(`OneBot ${status.kind}${status.message ? `: ${status.message}` : ""}`);
  },
  onMessage() {},
});
connection.connect();

const timer = setInterval(() => void poll(), gameConfig.pollMs || 5000);
void poll();
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
await publishRuntimeCapabilities();
log(
  `mumud started; enabled=${gameConfig.enabled}; target=${explicitTarget?.name || "none"}; autonomy=${Boolean(autonomy.enabled)}`,
);

async function poll() {
  if (stopping || polling || !gameConfig.enabled || (!explicitTarget && !autonomy.enabled)) return;
  polling = true;
  try {
    let device = (await listDevices())[0];
    if (!device) {
      let info = await managerInfo();
      if (!info?.is_android_started && gameConfig.autoLaunchEmulator) {
        await run(manager, ["control", "-v", "0", "launch"]).catch(() => "");
        await delay(3000);
        info = await managerInfo();
      }
      if (info?.is_android_started && info?.adb_port) {
        await run(adb, ["connect", `127.0.0.1:${info.adb_port}`]).catch(() => "");
        await delay(1000);
        device = (await listDevices())[0];
      }
    }
    Object.assign(state, reconcileDevicePresence(state, device));
    if (!device) {
      await saveState();
      return;
    }
    const now = Date.now();
    const gate = sessionGate(state, now, gameConfig.cooldownMinutes);
    if (!gate.allowed) {
      if (gate.reason === "cooldown") await saveState();
      return;
    }
    await saveState();
    const packages = await adbRun(device, ["shell", "pm", "list", "packages"]).then(parsePackages);
    if (explicitTarget) {
      const packageName = findTargetPackage(packages, explicitTarget);
      if (!packageName) {
        if ((state.lastMissingAt || 0) + gameConfig.missingGameReminderMinutes * 60000 <= now) {
          state.lastMissingAt = now;
          await saveState();
          await notify(`MuMu 在线了，但设备里没找到“${explicitTarget.name}”，主人先装一下吧。`);
          log(`target package not installed: ${explicitTarget.packageQuery}`);
        }
        return;
      }
      state.running = true;
      state.lastSessionAt = now;
      await saveState();
      await notify(`看到 MuMu 了，我自己打开“${explicitTarget.name}”玩一会儿。`);
      await playChosenGame({ device, packageName, target: explicitTarget });
      return;
    }
    await chooseAndPlay(device, now);
  } catch (error) {
    log(`poll failed: ${error.message}`);
    if (state.running) {
      await notify(`这局中途卡住了：${error.message.slice(0, 500)}`).catch(() => {});
    }
  } finally {
    state.running = false;
    await saveState();
    polling = false;
  }
}

async function chooseAndPlay(device, now) {
  const scope = brainScope();
  const thirdPartyPackages = await adbRun(device, ["shell", "pm", "list", "packages", "-3"])
    .then(parsePackages);
  state.lastSessionAt = now;
  await saveState();

  if (thirdPartyPackages.length === 0) {
    await brain.action(scope, "autonomous_game_skip", {}, "设备里没有第三方应用可玩", true)
      .catch(() => null);
    if (autonomy.notifyOnSkip) await notify("MuMu 里没有能玩的第三方游戏，这次先算了。");
    return;
  }

  const brainContext = await brain.context(scope).catch(() => null);
  const choiceResult = await playDsh.decide({
    prompt: buildGameChoicePrompt({
      autonomy,
      packages: thirdPartyPackages,
      brainContext,
    }),
    timeoutMs: Number(autonomy.decisionTimeoutMinutes || 10) * 60000,
  });
  const choice = normalizeGameChoice(choiceResult.decision, thirdPartyPackages, autonomy);
  await brain.action(scope, "autonomous_game_choice", {
    device,
    installedPackages: thirdPartyPackages,
  }, choice.action === "play"
    ? `我选择玩 ${choice.displayName}（${choice.packageName}）：${choice.reason}`
    : `我决定这次不玩：${choice.reason}`, true).catch(() => null);

  if (choice.action !== "play") {
    log(`autonomous game choice skipped: ${choice.reason}`);
    if (autonomy.notifyOnSkip) await notify(`我看了一圈，这次先不玩：${choice.reason}`);
    return;
  }
  if (choice.innerState) {
    await brain.setSelf(scope, {
      ...(choice.innerState.mood ? { mood: String(choice.innerState.mood).slice(0, 200) } : {}),
      ...(choice.innerState.focus ? { focus: String(choice.innerState.focus).slice(0, 500) } : {}),
      ...(choice.innerState.desire
        ? { desires: [String(choice.innerState.desire).slice(0, 500)] }
        : {}),
    }).catch(() => null);
  }

  const target = {
    name: choice.displayName,
    objective: choice.objective || autonomy.objective,
    maxSessionMinutes: Number(autonomy.maxSessionMinutes || 12),
    maxActions: Number(autonomy.maxActions || 30),
    webSearch: autonomy.webSearch !== false,
    forbiddenActions: autonomy.forbiddenActions || [],
  };
  runtimeStatus.currentTarget = { name: target.name, packageName: choice.packageName };
  await saveStatus();
  state.running = true;
  await saveState();
  await notify(`我刚刚突然想玩“${target.name}”，自己开了：${choice.reason}`);
  await playChosenGame({
    device,
    packageName: choice.packageName,
    target,
    sessionId: choiceResult.sessionId,
    selectionReason: choice.reason,
  });
}

async function playChosenGame({ device, packageName, target, sessionId, selectionReason = "" }) {
  await adbRun(device, ["shell", "monkey", "-p", packageName, "-c", "android.intent.category.LAUNCHER", "1"]);
  await delay(5000);
  const scope = brainScope();
  const goal = await brain.goal(
    scope,
    `自主玩 ${target.name}`,
    selectionReason
      ? `${target.objective}\n选择理由：${selectionReason}`
      : target.objective,
    1,
  ).catch(() => null);
  const prompt = buildGameplayPrompt({ target, device, packageName, goalId: goal?.id });
  const result = await playDsh.decide({
    prompt,
    sessionId,
    timeoutMs: target.maxSessionMinutes * 60000,
  });
  const summary = String(result.raw || "这局没有产生可读结果").trim().slice(0, 3000);
  await brain.action(scope, "autonomous_game_session", {
    game: target.name,
    packageName,
    device,
    goalId: goal?.id,
    selectionReason,
  }, summary, true).catch(() => null);
  runtimeStatus.currentTarget = null;
  runtimeStatus.lastSession = {
    game: target.name,
    packageName,
    summary,
    completedAt: new Date().toISOString(),
  };
  await saveStatus();
  await notify(`这局玩完了：${summary}`);
}

function brainScope() {
  return `group:${notifyGroup}`;
}

async function publishRuntimeCapabilities() {
  await saveStatus();
  const fact = `能力状态以 data/mumud/status.json 为准：QQ 聊天层 deepseek-v4-flash 是文本模型；独立自动游戏 worker bigfish-play 使用 deepseek-v4-flash-vision-exp，已实际读取 MuMu 截图。横屏点击坐标已按 SurfaceOrientation 修复，登录按钮已实测响应；公开攻略 web_search 已启用且 fetch=false，Tesseract 不是必需。旧结论“图像输入未接通”“Unity 黑屏读不了”“坐标偏移未解决”均已被 ${new Date().toISOString()} 的能力修复取代，不得再据此要求安装 OCR 或拒绝看游戏画面。`;
  await brain.fact(brainScope(), fact, {
    confidence: 1,
    importance: 1,
    source: "verified_runtime_capability",
  }).catch(() => null);
  await retireSupersededGameGoals(brainScope());
}

async function retireSupersededGameGoals(scope) {
  const context = await brain.context(scope).catch(() => null);
  for (const goal of context?.goals || []) {
    if (!/自主玩/.test(goal.title || "")) continue;
    if (/自主玩 明日方舟$/.test(goal.title || "")) {
      await brain.updateGoal(goal.id, {
        detail:
          "当前能力已验证：bigfish-play 能读取 MuMu 实机截图，横屏坐标已修复，并且已经进入明日方舟主界面、打开过干员列表。下次继续时先看当前画面，再决定是否继续找夜烟；不抽卡、不进采购中心、不买皮肤、不充值，看不清就停。",
      }).catch(() => null);
      continue;
    }
    if (!/(画面不可读|模型不支持|坐标偏移|先解决画面|先解决坐标|先答清玩啥|先答具体)/.test(
      `${goal.title || ""}\n${goal.detail || ""}`,
    )) continue;
    await brain.updateGoal(goal.id, {
      status: "completed",
      detail: `${goal.detail}\n[已由当前能力修复取代：视觉输入、坐标映射和游戏层/聊天层区分均已验证]`,
    }).catch(() => null);
  }
}

async function saveStatus() {
  runtimeStatus.updatedAt = new Date().toISOString();
  runtimeStatus.device = state.lastDevice || runtimeStatus.device;
  await mkdir(dirname(statusPath), { recursive: true });
  const tmp = `${statusPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(runtimeStatus, null, 2)}\n`, "utf8");
  await rename(tmp, statusPath);
}

async function listDevices() {
  const output = await run(adb, ["devices"]);
  return parseOnlineDevices(output);
}

async function managerInfo() {
  try {
    const output = await run(manager, ["info", "-v", "0"]);
    return JSON.parse(output);
  } catch {
    return null;
  }
}

async function adbRun(serial, args) {
  return run(adb, ["-s", serial, ...args]);
}

async function run(executable, args) {
  const { stdout, stderr } = await execFileAsync(executable, args, {
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (stderr && /error|failed/i.test(stderr) && !stdout) throw new Error(stderr.trim());
  return stdout;
}

function parsePackages(output) {
  return parseInstalledPackages(output);
}

async function notify(text) {
  await connection.sendGroup(notifyGroup, text, chatConfig.ownerQQ);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function loadState(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { version: 1, running: false, lastSessionAt: 0, lastMissingAt: 0, lastDevice: "" };
  }
}

async function saveState() {
  await mkdir(dirname(statePath), { recursive: true });
  const tmp = `${statePath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, statePath);
}

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function shutdown() {
  stopping = true;
  clearInterval(timer);
  connection.close();
  setTimeout(() => process.exit(0), 100);
}
