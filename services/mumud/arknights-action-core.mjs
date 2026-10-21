const ACTION_TYPES = new Set([
  "Deploy",
  "Skill",
  "Retreat",
  "SpeedUp",
  "BulletTime",
  "SkillUsage",
  "SetUnitLocation",
]);

const DIRECTIONS = new Set(["Left", "Right", "Up", "Down", "None"]);
const FIELD_NAMES = {
  costChanges: "cost_changes",
  preDelay: "pre_delay",
  postDelay: "post_delay",
  skillUsage: "skill_usage",
  skillTimes: "skill_times",
  elapsedTime: "elapsed_time",
  keepKills: "keep_kills",
};

function boundedInteger(value, name, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return number;
}

function normalizeLocation(value, required = false) {
  if (value == null) {
    if (required) throw new Error("location is required");
    return undefined;
  }
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error("location must be [x, y]");
  }
  return [
    boundedInteger(value[0], "location.x", 0, 99),
    boundedInteger(value[1], "location.y", 0, 99),
  ];
}

function normalizeStageName(value) {
  const stageName = String(value || "").normalize("NFKC").trim();
  if (!stageName || stageName.length > 160) {
    throw new Error("stageName is required");
  }
  if (!/^[\p{L}\p{N}_./-]+$/u.test(stageName)) {
    throw new Error("stageName contains unsupported characters");
  }
  return stageName;
}

export function normalizeMaaArknightsAction(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("action must be an object");
  }
  const type = String(input.type || "Deploy").trim();
  if (!ACTION_TYPES.has(type)) {
    throw new Error(`unsupported Arknights action type: ${type}`);
  }

  const result = { type };
  for (const [key, value] of Object.entries(input)) {
    if (key === "type" || value == null) continue;
    const targetKey = FIELD_NAMES[key] || key;
    if (![
      "name",
      "role",
      "location",
      "direction",
      "kills",
      "costs",
      "cost_changes",
      "cooling",
      "elapsed_time",
      "pre_delay",
      "post_delay",
      "timeout",
      "skill_usage",
      "skill_times",
      "keep_kills",
      "doc",
      "doc_color",
    ].includes(targetKey)) {
      continue;
    }
    result[targetKey] = value;
  }

  if (result.name != null) {
    result.name = String(result.name).normalize("NFKC").trim().slice(0, 160);
    if (!result.name) delete result.name;
  }
  if (result.role != null) {
    result.role = String(result.role).trim().slice(0, 40);
  }
  if (result.location != null) {
    result.location = normalizeLocation(result.location, type === "Deploy");
  } else if (type === "Deploy") {
    normalizeLocation(undefined, true);
  }
  if (result.direction != null) {
    result.direction = String(result.direction).trim();
    if (!DIRECTIONS.has(result.direction)) {
      throw new Error("direction must be Left, Right, Up, Down or None");
    }
  } else if (type === "Deploy") {
    throw new Error("direction is required for Deploy");
  }
  if (type === "Deploy" && !result.name) {
    throw new Error("name is required for Deploy");
  }
  if (["Skill", "Retreat", "BulletTime", "SkillUsage", "SetUnitLocation"].includes(type)
      && !result.name
      && !result.location) {
    throw new Error(`${type} requires name or location`);
  }
  if (type === "SkillUsage" && result.skill_usage == null) {
    throw new Error("SkillUsage requires skillUsage");
  }

  for (const key of ["kills", "costs", "cost_changes", "cooling", "elapsed_time", "pre_delay", "post_delay"]) {
    if (result[key] != null) {
      const minimum = key === "cooling" ? -1 : 0;
      result[key] = boundedInteger(result[key], key, minimum, 999_999_999);
    }
  }
  if (result.timeout != null) {
    result.timeout = boundedInteger(result.timeout, "timeout", -1, 999_999_999);
  }
  if (result.skill_usage != null) {
    result.skill_usage = boundedInteger(result.skill_usage, "skill_usage", 0, 2);
  }
  if (result.skill_times != null) {
    result.skill_times = boundedInteger(result.skill_times, "skill_times", 1, 99);
  }
  if (result.doc != null) result.doc = String(result.doc).slice(0, 500);
  if (result.doc_color != null) result.doc_color = String(result.doc_color).slice(0, 40);
  return result;
}

export function buildMaaArknightsSingleStepTask({ stageName, action }) {
  const normalizedStage = normalizeStageName(stageName);
  const normalizedAction = normalizeMaaArknightsAction(action);
  return {
    tasks: [
      {
        name: "BigFish set current Arknights stage",
        type: "SingleStep",
        params: {
          type: "copilot",
          subtype: "stage",
          details: { stage_name: normalizedStage },
        },
      },
      {
        name: `BigFish ${normalizedAction.type}`,
        type: "SingleStep",
        params: {
          type: "copilot",
          subtype: "action",
          details: { actions: [normalizedAction] },
        },
      },
    ],
  };
}

export const ARKNIGHTS_ACTION_TYPES = [...ACTION_TYPES];
export const ARKNIGHTS_DIRECTIONS = [...DIRECTIONS];
