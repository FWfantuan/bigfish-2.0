import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { defineTool } from "@deepseek-ai/dsh-tools";
import {
  ARKNIGHTS_ACTION_TYPES,
  ARKNIGHTS_DIRECTIONS,
  buildScreenDeployGesture,
  buildMaaArknightsSingleStepTask,
} from "./bigfish-arknights-action-core.mjs";

const execFileAsync = promisify(execFile);
const SERIAL_PATTERN = /^[A-Za-z0-9.:_-]+$/;
const UI_ANCHORS = {
  confirm: [0.925, 0.944],
  cancel: [0.756, 0.944],
  pause_toggle: [0.944, 0.061],
  speed_toggle: [0.867, 0.068],
};

function projectRoot() {
  return resolve(process.env.BIGFISH_PROJECT_ROOT || process.cwd());
}

function maaPaths() {
  const root = resolve(
    process.env.MAA_ROOT
      || process.env.MAA_DATA_DIR
      || resolve(process.env.USERPROFILE || homedir(), "Desktop", "maa"),
  );
  return {
    root,
    cli: resolve(process.env.MAA_CLI_PATH || resolve(root, process.platform === "win32" ? "maa.exe" : "maa")),
    configDir: resolve(process.env.MAA_CONFIG_DIR || resolve(projectRoot(), "config", "maa")),
    stateDir: resolve(projectRoot(), "data", "maa", "state"),
    cacheDir: resolve(projectRoot(), "data", "maa", "cache"),
    logDir: resolve(projectRoot(), "data", "maa", "logs"),
  };
}

function maaEnvironment(paths) {
  return {
    ...process.env,
    MAA_DATA_DIR: paths.root,
    MAA_CONFIG_DIR: paths.configDir,
    MAA_STATE_DIR: paths.stateDir,
    MAA_CACHE_DIR: paths.cacheDir,
    MAA_LOG_PREFIX: "Always",
  };
}

async function ensureActionsProfile(paths) {
  const adb = process.env.ADB || "adb";
  const directory = resolve(paths.configDir, "profiles");
  const target = resolve(directory, "bigfish-actions.toml");
  const content = `[connection]
type = "ADB"
adb_path = ${JSON.stringify(adb)}
config = "MuMuEmulator12"

[resource]
user_resource = false

[static_options]
cpu_ocr = true

[instance_options]
touch_mode = "MaaTouch"
deployment_with_pause = false
adb_lite_enabled = false
kill_adb_on_exit = false
`;
  await mkdir(directory, { recursive: true });
  const temporary = `${target}.tmp`;
  await writeFile(temporary, content, "utf8");
  await rename(temporary, target);
}

async function adbScreenshot(serial) {
  const adb = process.env.ADB || "adb";
  const result = await execFileAsync(
    adb,
    ["-s", serial, "exec-out", "screencap", "-p"],
    {
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 32 * 1024 * 1024,
      encoding: null,
    },
  );
  const bytes = Buffer.isBuffer(result.stdout)
    ? result.stdout
    : Buffer.from(result.stdout);
  if (bytes.length === 0) throw new Error("device returned an empty screenshot");
  return {
    bytes,
    digest: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function adbDisplaySize(serial) {
  const adb = process.env.ADB || "adb";
  const result = await execFileAsync(
    adb,
    ["-s", serial, "shell", "wm", "size"],
    {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );
  const sizes = [...String(result.stdout || "").matchAll(/(\d+)\s*x\s*(\d+)/g)];
  const selected = sizes.at(-1);
  if (!selected) throw new Error("could not determine Android display size");
  return {
    width: Number(selected[1]),
    height: Number(selected[2]),
  };
}

async function adbTap(serial, point) {
  const adb = process.env.ADB || "adb";
  await execFileAsync(
    adb,
    ["-s", serial, "shell", "input", "tap", String(point.x), String(point.y)],
    {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );
}

async function adbSwipe(serial, from, to) {
  const adb = process.env.ADB || "adb";
  await execFileAsync(
    adb,
    [
      "-s", serial, "shell", "input", "swipe",
      String(from.x), String(from.y), String(to.x), String(to.y), "220",
    ],
    {
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );
}

async function saveScreenshot(bytes, prefix) {
  const directory = resolve(projectRoot(), "data", "media", "screenshots");
  await mkdir(directory, { recursive: true });
  const path = resolve(
    directory,
    `${prefix}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
  );
  await writeFile(path, bytes);
  return path;
}

export function createBigFishArknightsTools() {
  const maaAction = defineTool({
    name: "arknights_maa_action",
    description:
      "Let the user's MAA Core execute one low-level Arknights battle action while BigFish decides "
      + "the operator, tile, direction, skill timing and conditions. Supports Deploy, Skill, Retreat, "
      + "SpeedUp, BulletTime, SkillUsage and SetUnitLocation. MAA profiles run with "
      + "deployment_with_pause=false. Resume a paused battle before deploying, then verify placement "
      + "from a fresh screenshot. Use lane coordinates from MAA/map.ark-nights coordinates and the "
      + "current stage name. Do not ask MAA to choose strategy or use SkillDaemon.",
    parameters: {
      serial: {
        type: "string",
        required: true,
        description: "Online ADB serial, e.g. 127.0.0.1:16384",
      },
      stageName: {
        type: "string",
        required: true,
        description: "Current MAA stage name, code, stageId or levelId",
      },
      action: {
        type: "object",
        required: true,
        additionalProperties: false,
        description: "One MAA Copilot action chosen by BigFish",
        properties: {
          type: { type: "string", required: true, enum: ARKNIGHTS_ACTION_TYPES },
          name: { type: "string" },
          role: { type: "string" },
          location: {
            type: "array",
            items: { type: "integer" },
          },
          direction: { type: "string", enum: ARKNIGHTS_DIRECTIONS },
          kills: { type: "integer" },
          costs: { type: "integer" },
          costChanges: { type: "integer" },
          cooling: { type: "integer" },
          elapsedTime: { type: "integer" },
          preDelay: { type: "integer" },
          postDelay: { type: "integer" },
          timeout: { type: "integer" },
          skillUsage: { type: "integer" },
          skillTimes: { type: "integer" },
          doc: { type: "string" },
        },
      },
      resumeBeforeAction: {
        type: "boolean",
        description: "When the current screenshot is the manual PAUSE overlay, resume combat inside this same tool call immediately before MAA connects.",
      },
      pauseAfterAction: {
        type: "boolean",
        description: "Pause combat again inside this same tool call after MAA returns, so the next planning step has protected observation time.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          serial: { type: "string", required: true },
          stageName: { type: "string", required: true },
          actionType: { type: "string", required: true },
          deploymentWithPause: { type: "boolean", required: true, const: false },
          resumedBeforeAction: { type: "boolean", required: true },
          pausedAfterAction: { type: "boolean", required: true },
          postActionScreenshotPath: { type: "string", required: true },
          logPath: { type: "string", required: true },
          outputTail: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: JSON.stringify(value, null, 2),
      }],
    },
    timeoutMs: 90_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const serial = String(args.serial || "").trim();
      if (!SERIAL_PATTERN.test(serial)) throw new Error("invalid ADB serial");
      const task = buildMaaArknightsSingleStepTask({
        stageName: args.stageName,
        action: args.action,
      });
      const paths = maaPaths();
      await access(paths.cli, fsConstants.F_OK);
      await access(resolve(paths.root, "MaaCore.dll"), fsConstants.F_OK);
      await ensureActionsProfile(paths);
      let resumedBeforeAction = false;
      let pausedAfterAction = false;
      let postActionScreenshotPath = "";
      const pressPauseToggle = async () => {
        const adbPath = process.env.ADB || "adb";
        await execFileAsync(
          adbPath,
          [
            "-s",
            serial,
            "shell",
            "input",
            "tap",
            String(Math.round(UI_ANCHORS.pause_toggle[0] * 1920)),
            String(Math.round(UI_ANCHORS.pause_toggle[1] * 1080)),
          ],
          {
            windowsHide: true,
            timeout: 10_000,
            maxBuffer: 1024 * 1024,
          },
        );
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      };
      if (args.resumeBeforeAction === true) {
        await pressPauseToggle();
        resumedBeforeAction = true;
      }

      const tasksDirectory = resolve(paths.configDir, "tasks");
      await mkdir(tasksDirectory, { recursive: true });
      const taskPath = resolve(tasksDirectory, "bigfish-live-action.json");
      const temporaryTask = `${taskPath}.${randomUUID()}.tmp`;
      await writeFile(temporaryTask, JSON.stringify(task, null, 2), "utf8");
      await rename(temporaryTask, taskPath);
      await mkdir(paths.logDir, { recursive: true });
      const logPath = resolve(
        paths.logDir,
        `${new Date().toISOString().replace(/[:.]/g, "-")}-bigfish-live-action.log`,
      );
      const actionType = String(task.tasks[1]?.params?.details?.actions?.[0]?.type || "");
      if (!actionType) throw new Error("MAA single-step action type is missing");
      try {
        const result = await execFileAsync(
          paths.cli,
          [
            "run",
            "bigfish-live-action",
            "--addr",
            serial,
            "--profile",
            "bigfish-actions",
            "--no-summary",
            `--log-file=${logPath}`,
          ],
          {
            cwd: paths.root,
            windowsHide: true,
            timeout: 75_000,
            maxBuffer: 32 * 1024 * 1024,
            env: maaEnvironment(paths),
          },
        );
        let logTail = "";
        try {
          logTail = (await readFile(logPath, "utf8")).slice(-12_000);
        } catch {
          logTail = "";
        }
        if (args.pauseAfterAction === true) {
          await pressPauseToggle();
          pausedAfterAction = true;
        }
        const postAction = await adbScreenshot(serial);
        postActionScreenshotPath = await saveScreenshot(postAction.bytes, "arknights-after-action");
        return {
          ok: true,
          serial,
          stageName: String(task.tasks[0].params.details.stage_name),
          actionType,
          deploymentWithPause: false,
          resumedBeforeAction,
          pausedAfterAction,
          postActionScreenshotPath,
          logPath,
          outputTail: `${result.stdout}\n${result.stderr}\n${logTail}`.trim().slice(-16_000),
        };
      } catch (error) {
        let logTail = "";
        try {
          logTail = (await readFile(logPath, "utf8")).slice(-12_000);
        } catch {
          logTail = "";
        }
        const output = `${error.stdout || ""}\n${error.stderr || ""}\n${logTail}`.trim();
        throw new Error(
          `MAA Arknights action failed: ${error.message}`
          + `${output ? `\n${output.slice(-16_000)}` : ""}`,
        );
      }
    },
    presentCall: (args) => ({
      card: "generic",
      title: `MAA ${args.action?.type || "Arknights action"} on ${args.stageName}`,
      kind: "execute",
    }),
  });

  const screenDeploy = defineTool({
    name: "arknights_deploy_screen",
    description:
      "Deploy one Arknights operator using normalized screenshot coordinates when a roguelike map has no known MAA stageName or map grid. "
      + "BigFish chooses the visible operator card and target tile from the current screenshot. The tool resumes a manually paused battle, "
      + "taps the card and tile, selects the facing direction, then pauses and returns a fresh screenshot. Use one deployment at a time "
      + "and visually verify the postActionScreenshotPath before claiming success.",
    parameters: {
      serial: {
        type: "string",
        required: true,
        description: "Online ADB serial, e.g. 127.0.0.1:16384",
      },
      operatorName: {
        type: "string",
        description: "Operator name visible on the selected card, for traceability.",
      },
      cardPoint: {
        type: "array",
        required: true,
        items: { type: "number" },
        description: "Normalized [x, y] center of the operator card in the current screenshot, each from 0 to 1.",
      },
      tilePoint: {
        type: "array",
        required: true,
        items: { type: "number" },
        description: "Normalized [x, y] center of the target battle tile in the current screenshot, each from 0 to 1.",
      },
      direction: {
        type: "string",
        required: true,
        enum: ARKNIGHTS_DIRECTIONS,
        description: "Facing direction selected after tapping the deployment tile.",
      },
      resumeBeforeAction: {
        type: "boolean",
        description: "Set true when the current screenshot is the manual PAUSE overlay.",
      },
      pauseAfterAction: {
        type: "boolean",
        description: "Pause again after deployment for protected visual verification. Recommended true.",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          ok: { type: "boolean", required: true },
          serial: { type: "string", required: true },
          operatorName: { type: "string", required: true },
          direction: { type: "string", required: true },
          changed: { type: "boolean", required: true },
          resumedBeforeAction: { type: "boolean", required: true },
          pausedAfterAction: { type: "boolean", required: true },
          postActionScreenshotPath: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: JSON.stringify(value, null, 2),
      }],
    },
    timeoutMs: 45_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const serial = String(args.serial || "").trim();
      if (!SERIAL_PATTERN.test(serial)) throw new Error("invalid ADB serial");
      const size = await adbDisplaySize(serial);
      const gesture = buildScreenDeployGesture({
        cardPoint: args.cardPoint,
        tilePoint: args.tilePoint,
        direction: args.direction,
        width: size.width,
        height: size.height,
      });
      const before = await adbScreenshot(serial);
      const pausePoint = {
        x: Math.round(UI_ANCHORS.pause_toggle[0] * size.width),
        y: Math.round(UI_ANCHORS.pause_toggle[1] * size.height),
      };
      const resumeBeforeAction = args.resumeBeforeAction === true;
      const pauseAfterAction = args.pauseAfterAction === true;
      if (resumeBeforeAction) {
        await adbTap(serial, pausePoint);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
      }
      await adbTap(serial, gesture.card);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      await adbTap(serial, gesture.tile);
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 180));
      if (gesture.direction !== "None") {
        await adbSwipe(serial, gesture.tile, gesture.end);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
      if (pauseAfterAction) {
        await adbTap(serial, pausePoint);
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
      const after = await adbScreenshot(serial);
      const postActionScreenshotPath = await saveScreenshot(
        after.bytes,
        "arknights-screen-deploy",
      );
      return {
        ok: true,
        serial,
        operatorName: String(args.operatorName || "").trim().slice(0, 80),
        direction: gesture.direction,
        changed: before.digest !== after.digest,
        resumedBeforeAction: resumeBeforeAction,
        pausedAfterAction,
        postActionScreenshotPath,
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Deploy ${args.operatorName || "operator"} at screen tile`,
      kind: "execute",
    }),
  });

  const pressUi = defineTool({
    name: "arknights_press_ui",
    description:
      "Press a stable Arknights 16:9 UI anchor and verify that the screen changed. Use confirm for "
      + "standard right-bottom confirmation buttons such as recruitment confirmation. This replaces "
      + "guessing the button center from a scaled image. pause_toggle and speed_toggle are for observation; "
      + "use arknights_maa_action for deployments because its MAA profile pauses automatically.",
    parameters: {
      serial: {
        type: "string",
        required: true,
        description: "Online ADB serial",
      },
      target: {
        type: "string",
        required: true,
        enum: Object.keys(UI_ANCHORS),
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          sent: { type: "boolean", required: true },
          changed: { type: "boolean", required: true },
          serial: { type: "string", required: true },
          target: { type: "string", required: true },
          point: {
            type: "object",
            required: true,
            additionalProperties: false,
            properties: {
              x: { type: "integer", required: true },
              y: { type: "integer", required: true },
            },
          },
          screenshotPath: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: JSON.stringify(value, null, 2),
      }],
    },
    timeoutMs: 45_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const serial = String(args.serial || "").trim();
      if (!SERIAL_PATTERN.test(serial)) throw new Error("invalid ADB serial");
      const target = String(args.target || "");
      const anchor = UI_ANCHORS[target];
      if (!anchor) throw new Error("unsupported Arknights UI target");
      const before = await adbScreenshot(serial);
      const adb = process.env.ADB || "adb";
      const point = {
        x: Math.round(anchor[0] * 1920),
        y: Math.round(anchor[1] * 1080),
      };
      await execFileAsync(
        adb,
        ["-s", serial, "shell", "input", "tap", String(point.x), String(point.y)],
        { windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024 },
      );
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 350));
      const after = await adbScreenshot(serial);
      const screenshotPath = await saveScreenshot(after.bytes, `arknights-${target}`);
      return {
        sent: true,
        changed: before.digest !== after.digest,
        serial,
        target,
        point,
        screenshotPath,
      };
    },
    presentCall: (args) => ({
      card: "generic",
      title: `Press Arknights ${args.target}`,
      kind: "execute",
    }),
  });

  const askOwner = defineTool({
    name: "arknights_ask_owner",
    description:
      "Pause before a strategic Arknights choice that BigFish cannot confidently make and ask the owner. "
      + "Use this for opening squad/operators, an unfamiliar relic, competing route/event choices, or "
      + "two viable tactical plans with materially different consequences. The current screen is sent to "
      + "the owner automatically. State the concrete options, your recommendation and why you are unsure. "
      + "Do not use it for trivial clicks or as a substitute for trying to understand the game.",
    parameters: {
      game: {
        type: "string",
        description: "Current game/mode label",
      },
      question: {
        type: "string",
        required: true,
        description: "Specific BigFish-style question naming the current choice",
      },
      options: {
        type: "array",
        items: { type: "string" },
        description: "Visible choices, in short labels",
      },
      recommendation: {
        type: "string",
        description: "BigFish's current preference and reason",
      },
      timeoutMinutes: {
        type: "integer",
        description: "How long to wait, default 5 and maximum 10 minutes",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          answered: { type: "boolean", required: true },
          timedOut: { type: "boolean", required: true },
          questionId: { type: "string", required: true },
          answer: { type: "string", required: true },
        },
      },
      render: (_args, value) => [{
        type: "text",
        text: JSON.stringify(value, null, 2),
      }],
    },
    timeoutMs: 11 * 60_000,
    isConcurrencySafe: () => false,
    async execute(args) {
      const question = String(args.question || "").trim().slice(0, 1200);
      if (!question) throw new Error("question is required");
      const options = Array.isArray(args.options)
        ? args.options.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
        : [];
      const recommendation = String(args.recommendation || "").trim().slice(0, 300);
      const timeoutMinutes = Math.max(
        1,
        Math.min(10, Number(args.timeoutMinutes) || 5),
      );
      const questionId = randomUUID();
      const directory = resolve(projectRoot(), "data", "mumud");
      const requestPath = resolve(directory, "question.request.json");
      const activePath = resolve(directory, "question.active.json");
      const answerPath = resolve(directory, "question.answer.json");
      await mkdir(directory, { recursive: true });
      const temporary = `${requestPath}.${questionId}.tmp`;
      await writeFile(temporary, JSON.stringify({
        version: 1,
        id: questionId,
        createdAt: new Date().toISOString(),
        game: String(args.game || "明日方舟").slice(0, 120),
        question,
        options,
        recommendation,
      }, null, 2), "utf8");
      await rename(temporary, requestPath);

      const deadline = Date.now() + timeoutMinutes * 60_000;
      while (Date.now() < deadline) {
        try {
          const answer = JSON.parse(await readFile(answerPath, "utf8"));
          if (String(answer.questionId || "") === questionId) {
            await Promise.all([
              unlink(activePath).catch(() => null),
              unlink(answerPath).catch(() => null),
            ]);
            return {
              answered: true,
              timedOut: false,
              questionId,
              answer: String(answer.answer || "").trim().slice(0, 1000),
            };
          }
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 750));
      }
      await Promise.all([
        unlink(requestPath).catch(() => null),
        unlink(activePath).catch(() => null),
      ]);
      return {
        answered: false,
        timedOut: true,
        questionId,
        answer: "",
      };
    },
    presentCall: () => ({
      card: "generic",
      title: "Ask owner about an Arknights choice",
      kind: "execute",
    }),
  });

  return {
    arknightsMaaAction: maaAction,
    arknightsScreenDeploy: screenDeploy,
    arknightsPressUi: pressUi,
    arknightsAskOwner: askOwner,
  };
}
