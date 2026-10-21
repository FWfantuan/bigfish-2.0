import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { DshDecisionMaker, loadEnvironmentFiles } from "../sociald/dsh.mjs";
import { loadConfig } from "../sociald/config.mjs";
import { OneBotConnection } from "../sociald/onebot.mjs";
import { BrainClient } from "../shared/brain-client.mjs";
import {
  buildGameChoicePrompt,
  buildGameplayObservationPrompt,
  buildGameplayPrompt,
  extractGameplayQqSummary,
  findTargetPackage,
  normalizeGameChoice,
  normalizeGameplayObservation,
  parseInstalledPackages,
  parseOnlineDevices,
  reconcileDevicePresence,
  resolveAgenticGameplayMode,
  resolveConfiguredGame,
  sessionGate,
  validateGameplayRequest,
} from "./core.mjs";
import {
  buildMaaLearningRecord,
  buildMaaQqSummary,
  isSupportedMaaResolution,
  MaaRunner,
  parseAndroidDisplaySize,
  resolveMaaTask,
} from "./maa.mjs";

const execFileAsync = promisify(execFile);
await loadEnvironmentFiles([".env", resolve(homedir(), ".dsh/.env")]);
const chatConfig = await loadConfig(process.env.BIGFISH_SOCIAL_CONFIG || "config/social.json");
const gameConfig = JSON.parse(await readFile("config/gameplay.json", "utf8"));
const statePath = resolve(process.env.BIGFISH_GAMEPLAY_STATE || "data/mumud/state.json");
const statusPath = resolve(process.env.BIGFISH_GAMEPLAY_STATUS || "data/mumud/status.json");
const requestPath = resolve(process.env.BIGFISH_GAMEPLAY_REQUEST || "data/mumud/request.json");
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
const gameObserverDsh = new DshDecisionMaker({ profile: "bigfish-play", timeoutMs: 45000 });
const explicitTarget = gameConfig.targets?.[0];
const autonomy = gameConfig.autonomy || { enabled: false };
const agenticGameplay = gameConfig.agenticGameplay || { enabled: false, modes: [] };
const maaConfig = gameConfig.maa || { enabled: false };
const maaRunner = new MaaRunner(maaConfig);
let maaProbe = {
  available: false,
  reason: maaConfig.enabled === false ? "disabled" : "not-probed",
};
const runtimeStatus = {
  version: 1,
  updatedAt: new Date().toISOString(),
  mode: autonomy.enabled ? "autonomous" : explicitTarget ? "fixed-target" : "disabled",
  fixedTarget: explicitTarget?.name || null,
  currentTarget: null,
  device: state.lastDevice || null,
  capabilities: {
    chatAgentImageInput: true,
    chatAgentModel: "deepseek-v4-flash-vision-exp",
    gameAgentImageInput: true,
    gameAgentModel: "deepseek-v4-flash-vision-exp",
    screenshotInputVerified: true,
    coordinateMapping: "rotation-aware",
    coordinateVerified: true,
    arknightsActions: {
      maaSingleStep: true,
      deploymentWithPause: true,
      semanticUiAnchors: true,
    },
    webSearch: { enabled: autonomy.webSearch !== false, fetch: false },
    tesseractRequired: false,
    maa: {
      enabled: maaConfig.enabled !== false,
      status: "not-probed",
      safeTasks: maaConfig.taskAllowlist || [],
    },
  },
  explanation:
    "QQ 聊天层和 bigfish-play 游戏层都使用视觉模型；QQ 图片会先保存到本地，Android 截图可作为图像输入。旧版“图像输入未接通/OCR 缺失/坐标漂移”的结论已被当前修复取代。",
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
      const ownerRequestWaiting = await hasFreshGameplayRequest(notifyGroup);
      let info = await managerInfo();
      if (!info?.is_android_started && (gameConfig.autoLaunchEmulator || ownerRequestWaiting)) {
        await run(manager, ["control", "-v", "0", "launch"]).catch(() => "");
        device = await waitForOnlineDevice(30_000);
        if (!device) info = await managerInfo();
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
    const ownerRequest = await consumeGameplayRequest(notifyGroup);
    if (ownerRequest) {
      state.lastSessionAt = 0;
      runtimeStatus.lastRequest = ownerRequest;
      await saveStatus();
      await brain.observe(brainScope(), "owner_game_request", ownerRequest, true).catch(() => null);
      log(`owner gameplay request: ${ownerRequest.game || "self-selected"}`);
    }
    const gate = ownerRequest ? { allowed: true, reason: "owner-request", remainingMs: 0 }
      : sessionGate(state, now, gameConfig.cooldownMinutes);
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
      await playChosenGame({
        device,
        packageName,
        target: explicitTarget,
        ownerRequest,
      });
      return;
    }
    await chooseAndPlay(device, now, ownerRequest);
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

async function chooseAndPlay(device, now, ownerRequest = null) {
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

  const configured = resolveConfiguredGame(ownerRequest?.game, thirdPartyPackages, gameConfig.gameAliases);
  if (configured) {
    const target = {
      name: configured.displayName,
      objective: autonomy.objective,
      maxSessionMinutes: Number(autonomy.maxSessionMinutes || 12),
      maxActions: Number(autonomy.maxActions || 30),
      webSearch: autonomy.webSearch !== false,
      forbiddenActions: autonomy.forbiddenActions || [],
    };
    runtimeStatus.currentTarget = { name: target.name, packageName: configured.packageName };
    await saveStatus();
    state.running = true;
    await saveState();
    await playChosenGame({
      device,
      packageName: configured.packageName,
      target,
      selectionReason: ownerRequest.reason || "主人明确指定",
      ownerRequest,
    });
    return;
  }

  const brainContext = await brain.context(scope).catch(() => null);
  const choiceResult = await playDsh.decide({
    prompt: buildGameChoicePrompt({
      autonomy,
      packages: thirdPartyPackages,
      brainContext,
      ownerRequest,
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
    ownerRequest,
  });
}

async function playChosenGame({
  device,
  packageName,
  target,
  sessionId,
  selectionReason = "",
  ownerRequest = null,
}) {
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
  const maaHint = [
    ownerRequest?.game,
    selectionReason,
    target.objective,
    target.name,
  ].filter(Boolean).join(" ");
  const agenticMode = resolveAgenticGameplayMode(maaHint, agenticGameplay);
  if (!agenticMode) {
    const maaTask = resolveMaaTask(packageName, maaConfig, maaHint);
    if (maaTask) {
      const maaOutcome = await playWithMaa({
        device,
        packageName,
        target,
        goal,
        task: maaTask,
        selectionReason,
        ownerRequest,
      });
      if (maaOutcome.handled) return;
    }
  }
  const activeTarget = agenticMode
    ? {
        ...target,
        objective: agenticMode.objective || target.objective,
        maxSessionMinutes: Number(agenticMode.maxSessionMinutes || target.maxSessionMinutes),
        maxActions: Number(agenticMode.maxActions || target.maxActions),
        webSearch: agenticMode.webSearch !== false,
      }
    : target;
  const prompt = buildGameplayPrompt({
    target: activeTarget,
    device,
    packageName,
    goalId: goal?.id,
    agenticMode,
  });
  const stopObserver = startGameplayObserver({
    device,
    game: activeTarget.name,
    modeName: agenticMode?.name || "",
    observation: agenticMode?.observation,
    groupId: ownerRequest?.groupId || notifyGroup,
  });
  let result;
  try {
    result = await playDsh.decide({
      prompt,
      sessionId,
      timeoutMs: activeTarget.maxSessionMinutes * 60000,
    });
  } finally {
    await stopObserver();
  }
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
    engine: "bigfish-play",
    game: target.name,
    packageName,
    summary,
    qqSummary: extractGameplayQqSummary(summary),
    completedAt: new Date().toISOString(),
  };
  await saveStatus();
  await notify(extractGameplayQqSummary(summary), ownerRequest?.groupId || notifyGroup);
}

async function playWithMaa({
  device,
  packageName,
  target,
  goal,
  task,
  selectionReason,
  ownerRequest = null,
}) {
  const scope = brainScope();
  const allowlist = maaConfig.taskAllowlist || [];
  if (!allowlist.includes(task)) {
    const error = `MAA task ${task} is not in the configured allowlist`;
    log(error);
    return { handled: false, error };
  }
  const taskProfile = maaConfig.taskProfiles?.[task] || {};

  maaProbe = await maaRunner.probe();
  runtimeStatus.capabilities.maa = {
    enabled: true,
    status: maaProbe.available ? "ready" : "unavailable",
    cliVersion: maaProbe.cliVersion || null,
    coreVersion: maaProbe.coreVersion || null,
    reason: maaProbe.reason,
    safeTasks: allowlist,
  };
  await saveStatus();
  if (!maaProbe.available) {
    const error = maaProbe.error || maaProbe.reason;
    await brain.action(scope, "autonomous_game_engine", {
      engine: "maa",
      game: target.name,
      packageName,
      phase: "preflight",
      probe: maaProbe,
    }, `MAA 前置检查失败：${error}`, false).catch(() => null);
    if (maaConfig.fallbackOnPreflightFailure !== false) {
      log(`MAA preflight failed; using bigfish-play: ${error}`);
      return { handled: false, error };
    }
    const result = { ok: false, phase: "preflight", error };
    const qqSummary = buildMaaQqSummary({ game: target.name, result });
    runtimeStatus.currentTarget = null;
    runtimeStatus.lastSession = {
      engine: "maa",
      game: target.name,
      packageName,
      ok: false,
      error,
      qqSummary,
      completedAt: new Date().toISOString(),
    };
    await saveStatus();
    await notify(qqSummary);
    return { handled: true, result };
  }

  const displayOutput = await adbRun(device, ["shell", "wm", "size"]).catch(() => "");
  const display = parseAndroidDisplaySize(displayOutput);
  const supported = isSupportedMaaResolution(display, maaConfig.supportedResolutions);
  runtimeStatus.capabilities.maa.display = display;
  runtimeStatus.capabilities.maa.resolutionSupported = supported;
  await saveStatus();
  if (!supported) {
    const size = display ? `${display.width}x${display.height}` : "未知";
    const error = `MuMu 当前分辨率 ${size} 不是 MAA 支持的横屏 1280x720/1920x1080`;
    await brain.action(scope, "autonomous_game_engine", {
      engine: "maa",
      game: target.name,
      packageName,
      phase: "preflight",
      display,
    }, error, false).catch(() => null);
    if (maaConfig.fallbackOnPreflightFailure !== false) {
      log(`MAA resolution check failed; using bigfish-play: ${error}`);
      return { handled: false, error };
    }
    const result = { ok: false, phase: "preflight", error };
    const qqSummary = buildMaaQqSummary({ game: target.name, result });
    runtimeStatus.currentTarget = null;
    runtimeStatus.lastSession = {
      engine: "maa",
      game: target.name,
      packageName,
      ok: false,
      error,
      qqSummary,
      completedAt: new Date().toISOString(),
    };
    await saveStatus();
    await notify(qqSummary);
    return { handled: true, result };
  }

  const stopObserver = startGameplayObserver({
    device,
    game: target.name,
    modeName: target.name,
    observation: maaConfig.observation,
    groupId: ownerRequest?.groupId || notifyGroup,
  });
  let result;
  try {
    result = await maaRunner.run({
      task,
      address: device,
      timeoutMs: Number(
        taskProfile.maxRuntimeMinutes || maaConfig.maxRuntimeMinutes || 20,
      ) * 60_000,
      verbose: taskProfile.verbose === true,
    });
  } finally {
    await stopObserver();
  }
  const learningRecord = buildMaaLearningRecord({ task, taskProfile, result });
  const factualSummary = result.ok
    ? [
        `MAA completed task ${task} for ${target.name} (${packageName}).`,
        `MAA CLI ${result.cliVersion || "unknown"}, core ${result.coreVersion || "unknown"}.`,
        `Completed task chains: ${result.completed?.map((item) => item.name).join(", ") || "none reported"}.`,
        learningRecord.meaningful === false
          ? "This run is not a meaningful learning sample because no exploration or combat started."
          : "",
        result.battles?.length ? `Battle output: ${result.battles.join(" | ")}` : "",
        learningRecord.evidence?.length
          ? `Roguelike evidence:\n${learningRecord.evidence.slice(-60).join("\n")}`
          : "",
      ].filter(Boolean).join("\n")
    : [
        `MAA task ${task} failed during ${result.phase || "execution"}.`,
        result.error || "",
        result.outputTail ? `Output tail:\n${result.outputTail}` : "",
      ].filter(Boolean).join("\n");
  await brain.action(scope, "autonomous_game_session", {
    engine: "maa",
    game: target.name,
    packageName,
    device,
    goalId: goal?.id,
    selectionReason,
    task,
    phase: result.phase,
    ok: result.ok,
    logFile: result.logFile,
    learningRecord,
  }, factualSummary, learningRecord.meaningful !== false).catch(() => null);

  const qqSummary = buildMaaQqSummary({
    game: target.name,
    result: learningRecord,
    taskProfile,
  });
  runtimeStatus.currentTarget = null;
  runtimeStatus.lastSession = {
    engine: "maa",
    game: target.name,
    packageName,
    task,
    ok: learningRecord.meaningful !== false,
    completedTasks: result.completedTasks || 0,
    error: result.error || null,
    logFile: result.logFile || null,
    learningRecord,
    summary: factualSummary,
    qqSummary,
    completedAt: new Date().toISOString(),
  };
  await saveStatus();
  await notify(qqSummary);
  return { handled: true, result };
}

function brainScope() {
  return `group:${notifyGroup}`;
}

async function publishRuntimeCapabilities() {
  maaProbe = await maaRunner.probe().catch((error) => ({
    available: false,
    reason: "probe-failed",
    error: error.message,
  }));
  runtimeStatus.capabilities.maa = {
    enabled: maaConfig.enabled !== false,
    status: maaProbe.available ? "ready" : "unavailable",
    cliVersion: maaProbe.cliVersion || null,
    coreVersion: maaProbe.coreVersion || null,
    reason: maaProbe.reason,
    safeTasks: maaConfig.taskAllowlist || [],
  };
  await saveStatus();
  const fact = `能力状态以 data/mumud/status.json 为准：QQ 聊天层和 bigfish-play 自动游戏层均使用 deepseek-v4-flash-vision-exp。MAA 引擎状态为 ${runtimeStatus.capabilities.maa.status}${maaProbe.coreVersion ? `，MaaCore ${maaProbe.coreVersion}` : ""}，只开放安全任务 ${(maaConfig.taskAllowlist || []).join("、") || "无"}。QQ 用户图片会保存到 data/qq-images，Android 截图也已验证为真实图像输入。横屏点击坐标按 SurfaceOrientation 修复；公开攻略 web_search 已启用且 fetch=false，Tesseract 不是必需。旧结论“QQ 文本模型读不了图”“图像输入未接通”“Unity 黑屏”“坐标偏移未解决”均已被当前能力修复取代。`;
  await brain.replaceFacts(brainScope(), "verified_runtime_capability", [{
    text: fact,
    confidence: 1,
    importance: 1,
  }]).catch(() => null);
  await retireSupersededGameGoals(brainScope());
}

async function retireSupersededGameGoals(scope) {
  const context = await brain.context(scope).catch(() => null);
  for (const goal of context?.goals || []) {
    if (!/自主玩/.test(goal.title || "")) continue;
    if (/自主玩 明日方舟$/.test(goal.title || "")) {
      await brain.updateGoal(goal.id, {
        detail:
          "明日方舟优先交给 MAA 的安全任务 arknights-safe：识别当前界面后自动打一把，medicine=0、stone=0、times=1。MAA 前置检查失败时才由视觉模型接管；两套引擎都不能进入商店、抽卡、买皮肤或充值。",
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

async function consumeGameplayRequest(expectedGroup) {
  const claimPath = `${requestPath}.claim-${Date.now()}`;
  try {
    await rename(requestPath, claimPath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    log(`gameplay request claim failed: ${error.message}`);
    return null;
  }
  try {
    const request = JSON.parse(await readFile(claimPath, "utf8"));
    if (!validateGameplayRequest(request, expectedGroup)) {
      log("discarded invalid or stale gameplay request");
      return null;
    }
    return request;
  } catch (error) {
    log(`gameplay request parse failed: ${error.message}`);
    return null;
  } finally {
    await unlink(claimPath).catch(() => null);
  }
}

async function hasFreshGameplayRequest(expectedGroup) {
  try {
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    return validateGameplayRequest(request, expectedGroup);
  } catch {
    return false;
  }
}

async function waitForOnlineDevice(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(2000);
    const device = (await listDevices())[0];
    if (device) return device;
  }
  return "";
}

function startGameplayObserver({
  device,
  game,
  modeName = "",
  observation = null,
  groupId = notifyGroup,
}) {
  const config = observation || {};
  if (config.enabled === false || !observation) {
    return async () => {};
  }
  const firstDelayMs = Number(config.firstDelayMs || 45_000);
  const intervalMs = Number(config.intervalMs || 90_000);
  const timeoutMs = Number(config.timeoutMs || 45_000);
  const maxShares = Number(config.maxShares ?? 2) === 0
    ? Number.POSITIVE_INFINITY
    : Number(config.maxShares ?? 2);
  const maxQuestions = Number(config.maxQuestions ?? 2) === 0
    ? Number.POSITIVE_INFINITY
    : Number(config.maxQuestions ?? 2);
  let stopped = false;
  let timer = null;
  let inFlight = null;
  let shares = 0;
  let questions = 0;
  const sharedDigests = new Set();
  const startedAt = Date.now();

  const schedule = (delayMs) => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = observe()
        .catch((error) => log(`gameplay observer failed: ${error.message}`))
        .finally(() => {
          inFlight = null;
          schedule(intervalMs);
        });
    }, Math.max(1_000, delayMs));
    timer.unref?.();
  };

  const observe = async () => {
    if (stopped || (shares >= maxShares && questions >= maxQuestions)) return;
    const decision = await gameObserverDsh.decide({
      prompt: buildGameplayObservationPrompt({
        game,
        modeName,
        elapsedSeconds: Math.floor((Date.now() - startedAt) / 1000),
        shares,
        questions,
        maxShares: config.maxShares ?? 2,
        maxQuestions: config.maxQuestions ?? 2,
      }),
      timeoutMs,
    });
    if (stopped) return;
    const observation = normalizeGameplayObservation(decision.decision);
    if (observation.action === "none") return;
    if (observation.action === "share" && shares < maxShares) {
      const screenshot = await captureGameplayScreenshot(device);
      if (sharedDigests.has(screenshot.digest)) return;
      sharedDigests.add(screenshot.digest);
      await sendGameplayImage({
        screenshot,
        caption: observation.text || "这波有点意思 给你看一眼",
        groupId,
      });
      shares += 1;
    }
    if (observation.action === "ask" && questions < maxQuestions) {
      const screenshot = await captureGameplayScreenshot(device);
      await sendGameplayImage({
        screenshot,
        caption: observation.text || "这里我拿不准 你看一下该怎么选",
        mentionOwner: true,
        groupId,
      });
      questions += 1;
    }
    await brain.action(brainScope(), "gameplay_observation", {
      engine: "bigfish-play",
      game,
      action: observation.action,
      reason: observation.reason,
      shares,
      questions,
    }, observation.text || observation.reason, true).catch(() => null);
  };

  schedule(firstDelayMs);
  return async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (inFlight) {
      await Promise.race([inFlight.catch(() => null), delay(3_000)]);
    }
  };
}

async function captureGameplayScreenshot(device) {
  const binary = await execFileAsync(adb, ["-s", device, "exec-out", "screencap", "-p"], {
    windowsHide: true,
    timeout: 30000,
    maxBuffer: 24 * 1024 * 1024,
    encoding: null,
  });
  const bytes = Buffer.isBuffer(binary.stdout) ? binary.stdout : Buffer.from(binary.stdout);
  if (bytes.length === 0) throw new Error("设备返回空截图");
  const directory = resolve("data/media/gameplay");
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  await writeFile(path, bytes);
  return {
    bytes,
    path,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function sendGameplayImage({
  screenshot,
  caption,
  mentionOwner = false,
  groupId = notifyGroup,
}) {
  const message = [];
  if (mentionOwner) {
    message.push(
      { type: "at", data: { qq: String(chatConfig.ownerQQ) } },
      { type: "text", data: { text: " " } },
    );
  }
  message.push(
    { type: "image", data: { file: `base64://${screenshot.bytes.toString("base64")}` } },
    { type: "text", data: { text: `\n${caption}` } },
  );
  await connection.action("send_group_msg", {
    group_id: Number(groupId),
    message,
  });
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

async function notify(text, groupId = notifyGroup) {
  await connection.sendGroup(groupId, text, chatConfig.ownerQQ);
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
