import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const DEFAULTS = {
  enabled: false,
  onebot: { url: "ws://127.0.0.1:3001", tokenEnv: "BIGFISH_ONEBOT_TOKEN" },
  botQQ: "",
  ownerQQ: "",
  groups: [],
  privateAllowlist: [],
  evaluation: {
    debounceMs: 45000,
    heartbeatMs: 900000,
    minEvaluationIntervalMs: 900000,
    quietStartHour: 1,
    quietEndHour: 8,
    globalCooldownMs: 600000,
    groupCooldownMs: 1200000,
    maxActionsPerHour: 3,
    maxMessageChars: 300,
  },
  dsh: { profile: "bigfish-worker", timeoutMs: 180000 },
  persona: { name: "大肥鱼", style: "", interests: [], boundaries: [] },
};

function merge(base, value) {
  const result = structuredClone(base);
  for (const [key, next] of Object.entries(value || {})) {
    const current = result[key];
    result[key] =
      next && current && typeof next === "object" && !Array.isArray(next)
        ? merge(current, next)
        : next;
  }
  return result;
}

export async function loadConfig(path = "config/social.json") {
  const raw = JSON.parse(await readFile(resolve(path), "utf8"));
  const config = merge(DEFAULTS, raw);
  config.botQQ = String(config.botQQ || "");
  config.ownerQQ = String(config.ownerQQ || "");
  config.groups = config.groups.map(String);
  config.privateAllowlist = config.privateAllowlist.map(String);
  if (!config.groups.length) throw new Error("social groups allowlist is empty");
  return config;
}
