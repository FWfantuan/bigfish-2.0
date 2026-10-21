import { execFile } from "node:child_process";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAA_TASK_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const DEFAULT_RESOLUTIONS = [
  [1280, 720],
  [1920, 1080],
];

export function parseAndroidDisplaySize(output) {
  const overrides = [...String(output || "").matchAll(/Override size:\s*(\d+)x(\d+)/gi)];
  const physical = [...String(output || "").matchAll(/Physical size:\s*(\d+)x(\d+)/gi)];
  const match = overrides.at(-1) || physical.at(-1);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  return { width, height };
}

export function isSupportedMaaResolution(size, supported = DEFAULT_RESOLUTIONS) {
  if (!size) return false;
  const landscape = [Math.max(size.width, size.height), Math.min(size.width, size.height)];
  return supported.some(
    ([width, height]) =>
      Math.max(width, height) === landscape[0] && Math.min(width, height) === landscape[1],
  );
}

export function resolveMaaTask(packageName, maaConfig = {}, hint = "") {
  const normalizedHint = String(hint || "").normalize("NFKC").toLowerCase();
  for (const rule of maaConfig.hintTasks || []) {
    if (!rule || typeof rule.task !== "string") continue;
    const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
    if (!keywords.some((keyword) => normalizedHint.includes(String(keyword).toLowerCase()))) {
      continue;
    }
    if (!Array.isArray(maaConfig.taskAllowlist) || maaConfig.taskAllowlist.includes(rule.task)) {
      return MAA_TASK_ID.test(rule.task) ? rule.task : null;
    }
  }

  const task = maaConfig.safeTasks?.[packageName];
  if (typeof task !== "string" || !MAA_TASK_ID.test(task)) return null;
  if (Array.isArray(maaConfig.taskAllowlist) && !maaConfig.taskAllowlist.includes(task)) {
    return null;
  }
  return task;
}

export function buildMaaArgs({ task, address, profile = "default", logFile, verbose = false }) {
  if (!MAA_TASK_ID.test(String(task || ""))) {
    throw new Error("MAA task id is invalid");
  }
  if (!address || !/^[a-zA-Z0-9.:_-]+$/.test(address)) {
    throw new Error("MAA device address is invalid");
  }
  const args = ["--batch", "run", task, "--addr", address, "--profile", profile];
  if (logFile) args.push(`--log-file=${logFile}`);
  if (verbose) args.push("-v");
  return args;
}

export function extractRoguelikeEvidence(output, limit = 120) {
  const lines = stripAnsi(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) =>
      /roguelike|integrated strateg|主题|分队|难度|希望|源石锭|藏品|招募|商店|节点|层|结局|通关|胜利|失败|放弃|战斗|作战|battle|combat|investment|floor|node|squad|theme|difficulty|encounter|relic|recruit/i
        .test(line),
    );
  return [...new Set(lines)].slice(-Math.max(1, Number(limit) || 120));
}

export function buildMaaLearningRecord({ task, taskProfile = {}, result = {} }) {
  const roguelike = taskProfile.domain === "arknights_roguelike";
  const evidence = roguelike ? extractRoguelikeEvidence(result.outputTail) : [];
  const practiceStarted = evidence.some((line) =>
    /Start exploration|StartCombat|开始探索|进入战斗|Start combat/i.test(line),
  );
  return {
    domain: taskProfile.domain || "game",
    game: "arknights",
    engine: "maa",
    task,
    theme: taskProfile.theme || null,
    mode: taskProfile.mode ?? null,
    squad: taskProfile.squad || null,
    roles: taskProfile.roles || null,
    difficulty: taskProfile.difficulty ?? null,
    startsCount: taskProfile.startsCount ?? null,
    investmentEnabled: taskProfile.investmentEnabled ?? null,
    ok: result.ok === true,
    meaningful: result.ok === true && (!roguelike || practiceStarted),
    practiceStarted,
    phase: result.phase || null,
    error: result.error || null,
    completedTasks: Number(result.completedTasks || 0),
    battles: Array.isArray(result.battles) ? result.battles.slice(-8) : [],
    errors: Array.isArray(result.errors) ? result.errors.slice(-12) : [],
    evidence,
  };
}

export function summarizeMaaOutput(stdout = "", stderr = "") {
  const text = stripAnsi(`${stdout}\n${stderr}`).trim();
  const completedById = new Map();
  for (const match of text.matchAll(
    /Completed Task Chain:\s*([^,\r\n]+)(?:,\s*Task ID:\s*(\d+))?/gi,
  )) {
    const name = match[1].trim();
    completedById.set(match[2] || name, {
      name,
      taskId: match[2] ? Number(match[2]) : null,
    });
  }
  for (const match of text.matchAll(/^\[([^\]\r\n]+)\]\s+.+?\bCompleted\s*$/gim)) {
    const name = match[1].trim();
    if (!completedById.has(name)) completedById.set(name, { name, taskId: null });
  }
  const completed = [...completedById.values()];
  const errors = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\[.*\]\[(?:ERR|ERROR)\]/i.test(line) || /failed|exception/i.test(line))
    .slice(-12);
  const battles = text.match(/(?:战斗|battle|fight)[^\r\n]{0,120}/gi)?.slice(-8) || [];
  return {
    completed,
    errors,
    battles,
    completedTasks: completed.length,
    outputTail: text.slice(-5000),
  };
}

export function resolveMaaPaths(config = {}, env = process.env) {
  const configuredRoot = config.root || env.MAA_ROOT || env.MAA_DATA_DIR;
  const root = configuredRoot
    ? resolve(expandPath(configuredRoot, env))
    : join(env.USERPROFILE || homedir(), "Desktop", "maa");
  const cli = resolve(expandPath(
    config.cliPath || env.MAA_CLI_PATH || join(root, process.platform === "win32" ? "maa.exe" : "maa"),
    env,
  ));
  const configDir = resolve(expandPath(config.configDir || "config/maa", env));
  const stateDir = resolve(expandPath(config.stateDir || "data/maa/state", env));
  const cacheDir = resolve(expandPath(config.cacheDir || "data/maa/cache", env));
  const logDir = resolve(expandPath(config.logDir || "data/maa/logs", env));
  return { root, cli, configDir, stateDir, cacheDir, logDir };
}

export class MaaRunner {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.env = options.env || process.env;
    this.execFile = options.execFile || execFileAsync;
    this.paths = resolveMaaPaths(config, this.env);
  }

  async probe() {
    if (this.config.enabled === false) {
      return {
        available: false,
        reason: "disabled",
        paths: this.paths,
      };
    }
    const required = [
      this.paths.cli,
      join(this.paths.root, "MaaCore.dll"),
      join(this.paths.root, "resource", "tasks", "tasks.json"),
      join(this.paths.configDir, "profiles", "default.toml"),
      join(this.paths.configDir, "tasks", "arknights-safe.toml"),
    ];
    const missing = [];
    for (const path of required) {
      try {
        await access(path, fsConstants.F_OK);
      } catch {
        missing.push(path);
      }
    }
    if (missing.length > 0) {
      return {
        available: false,
        reason: "missing-files",
        missing,
        paths: this.paths,
      };
    }

    try {
      const { stdout, stderr } = await this.execFile(this.paths.cli, ["version"], {
        cwd: this.paths.root,
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 4 * 1024 * 1024,
        env: this.#environment(),
      });
      const text = `${stdout}\n${stderr}`.trim();
      const cliVersion = text.match(/maa-cli\s+([^\r\n]+)/i)?.[1]?.trim() || null;
      const coreVersion = text.match(/MaaCore\s+([^\r\n]+)/i)?.[1]?.trim() || null;
      if (!coreVersion) {
        return {
          available: false,
          reason: "core-version-unavailable",
          output: text.slice(-2000),
          paths: this.paths,
        };
      }
      return {
        available: true,
        reason: "ready",
        cliVersion,
        coreVersion,
        paths: this.paths,
      };
    } catch (error) {
      return {
        available: false,
        reason: "probe-failed",
        error: error.message,
        paths: this.paths,
      };
    }
  }

  async run({ task, address, timeoutMs = 15 * 60_000, verbose = false }) {
    if (!MAA_TASK_ID.test(String(task || ""))) {
      return { ok: false, phase: "preflight", error: "MAA task id is invalid" };
    }
    const probe = await this.probe();
    if (!probe.available) {
      return {
        ok: false,
        phase: "preflight",
        error: probe.error || probe.reason,
        probe,
      };
    }

    const profile = this.config.profile || "runtime";
    await this.#writeRuntimeProfile(profile);
    await mkdir(this.paths.logDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logFile = join(this.paths.logDir, `${stamp}-${task}.log`);
    const args = buildMaaArgs({
      task,
      address,
      profile,
      logFile,
      verbose,
    });
    try {
      const { stdout, stderr } = await this.execFile(this.paths.cli, args, {
        cwd: this.paths.root,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: 32 * 1024 * 1024,
        env: this.#environment(),
      });
      const summary = summarizeMaaOutput(stdout, stderr);
      let logTail = "";
      try {
        logTail = (await readFile(logFile, "utf8")).slice(-20_000);
      } catch {
        // The CLI may only write the log after a successful task run.
      }
      const combined = summarizeMaaOutput(stdout, `${stderr}\n${logTail}`);
      return {
        ok: true,
        phase: "completed",
        task,
        address,
        logFile,
        cliVersion: probe.cliVersion,
        coreVersion: probe.coreVersion,
        ...combined,
        summary,
      };
    } catch (error) {
      const output = summarizeMaaOutput(error.stdout || "", error.stderr || "");
      return {
        ok: false,
        phase: error.killed ? "timeout" : "execution",
        task,
        address,
        logFile,
        error: error.message,
        ...output,
      };
    }
  }

  #environment() {
    return {
      ...this.env,
      MAA_DATA_DIR: this.paths.root,
      MAA_CONFIG_DIR: this.paths.configDir,
      MAA_STATE_DIR: this.paths.stateDir,
      MAA_CACHE_DIR: this.paths.cacheDir,
      MAA_LOG_PREFIX: "Always",
    };
  }

  async #writeRuntimeProfile(profile) {
    if (!MAA_TASK_ID.test(profile)) throw new Error("MAA profile name is invalid");
    const configuredAdb = expandEnvironment(
      this.config.adbPath || this.env.ADB || this.env.MUMU_ADB || "adb",
      this.env,
    );
    const adbPath = configuredAdb
      ? expandPath(configuredAdb, this.env)
      : "adb";
    const content = `[connection]
type = "ADB"
adb_path = ${JSON.stringify(adbPath)}
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
    const target = join(this.paths.configDir, "profiles", `${profile}.toml`);
    const temporary = `${target}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
  }
}

function expandPath(value, env) {
  if (!value) return value;
  let result = expandEnvironment(value, env);
  if (result === "~" || result.startsWith("~/") || result.startsWith("~\\")) {
    result = join(env.USERPROFILE || homedir(), result.slice(2));
  }
  if (!result.includes("/") && !result.includes("\\")) return result;
  return isAbsolute(result) ? result : resolve(result);
}

function expandEnvironment(value, env) {
  return String(value || "")
    .replace(/%([^%]+)%/g, (_, name) => env[name] || "")
    .replace(/\$\{([^}]+)\}/g, (_, name) => env[name] || "");
}

function stripAnsi(value) {
  return String(value || "").replace(
    // eslint-disable-next-line no-control-regex
    /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g,
    "",
  );
}
