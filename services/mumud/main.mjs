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
  const scope = `group:${notifyGroup}`;
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
    forbiddenActions: autonomy.forbiddenActions || [],
  };
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
  const scope = `group:${notifyGroup}`;
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
  await notify(`这局玩完了：${summary}`);
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
