const LIVE_TOOL_PREFIXES = ["android_", "arknights_"];
const LIVE_TOOLS = new Set(["web_search"]);
const MAX_RECENT_EVENTS = 40;

export function isLiveGameplayTool(name) {
  const value = String(name || "");
  return LIVE_TOOLS.has(value) || LIVE_TOOL_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function createLiveGameplayState({
  groupId,
  game,
  packageName,
  target = null,
  startedAt = new Date().toISOString(),
}) {
  return {
    version: 1,
    active: true,
    groupId: String(groupId || ""),
    sessionId: null,
    game: String(game || packageName || ""),
    packageName: String(packageName || ""),
    target,
    stageName: "",
    phase: "starting",
    startedAt,
    updatedAt: startedAt,
    current: null,
    lastVisibleText: "",
    latestScreenshotPath: "",
    recentEvents: [],
  };
}

export function applyLiveGameplayEvent(previous, event) {
  const state = structuredClone(previous);
  state.updatedAt = new Date().toISOString();
  state.pendingTools ||= {};
  state.recentEvents ||= [];

  const rawType = String(event?.type || "");
  const type = rawType === "tool_call"
    ? "tool/call"
    : rawType === "tool_result"
      ? "tool/result"
      : rawType;
  const data = event?.data && typeof event.data === "object" ? event.data : event || {};

  if (type === "session") {
    const sessionId = event.id || event.sessionId || data.sessionId;
    if (sessionId) state.sessionId = String(sessionId);
    return state;
  }

  if (type === "tool/call") {
    const name = String(data.name || data.tool || "");
    if (!isLiveGameplayTool(name)) return state;
    let args = data.arguments ?? data.input;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        // Keep malformed or partial arguments as a bounded display string.
      }
    }
    const callId = String(data.callId || `${name}:${Date.now()}`);
    const summary = summarizeToolCall(name, args);
    if (args && typeof args === "object" && args.stageName) {
      state.stageName = String(args.stageName).slice(0, 160);
    }
    state.pendingTools[callId] = { name, summary, startedAt: Date.now() };
    state.current = {
      callId,
      tool: name,
      action: args,
      summary,
      status: "running",
      startedAt: new Date().toISOString(),
      finishedAt: null,
      result: "",
      screenshotPath: "",
    };
    state.latestScreenshotPath = extractScreenshotPath(data) || state.latestScreenshotPath;
    state.recentEvents.push({
      at: new Date().toISOString(),
      kind: "tool",
      tool: name,
      summary,
      success: null,
    });
    state.recentEvents = state.recentEvents.slice(-MAX_RECENT_EVENTS);
    return state;
  }

  if (type === "tool/result") {
    const callId = String(data.toolCallId || data.callId || "");
    const pending = state.pendingTools[callId] || null;
    const name = pending?.name || state.current?.tool || "";
    const isError = data.message?.isError === true || data.status === "failed" || data.status === "error";
    const resultText = extractText(data.message?.content) || String(data.result || "").trim();
    const screenshotPath = extractScreenshotPath(data) || extractPathFromText(resultText);
    if (name && isLiveGameplayTool(name)) {
      state.current = {
        callId,
        tool: name,
        action: state.current?.callId === callId ? state.current.action : null,
        summary: pending?.summary || state.current?.summary || name,
        status: isError ? "failed" : "completed",
        startedAt: state.current?.callId === callId ? state.current.startedAt : null,
        finishedAt: new Date().toISOString(),
        result: resultText.slice(-1200),
        screenshotPath,
      };
      state.recentEvents.push({
        at: new Date().toISOString(),
        kind: "result",
        tool: name,
        summary: resultText.slice(0, 500) || (isError ? "tool failed" : "tool completed"),
        success: !isError,
      });
      state.recentEvents = state.recentEvents.slice(-MAX_RECENT_EVENTS);
    }
    if (screenshotPath) state.latestScreenshotPath = screenshotPath;
    if (callId) delete state.pendingTools[callId];
    return state;
  }

  if (type === "assistant/message") {
    const content = data.message?.content;
    const visible = Array.isArray(content)
      ? content
          .filter((part) => part?.type === "text")
          .map((part) => part.text || "")
          .join("\n")
          .trim()
      : "";
    if (visible) state.lastVisibleText = visible.slice(-2400);
    return state;
  }

  if (rawType === "text" && typeof event.text === "string" && event.text.trim()) {
    state.lastVisibleText = event.text.trim().slice(-2400);
    return state;
  }

  if (type === "turn/end") state.phase = "thinking";
  return state;
}

export function reloadLiveGameplayState(value) {
  if (!value || typeof value !== "object") return null;
  return {
    ...value,
    pendingTools:
      value.pendingTools && typeof value.pendingTools === "object"
        ? value.pendingTools
        : {},
    recentEvents: Array.isArray(value.recentEvents) ? value.recentEvents : [],
  };
}

function summarizeToolCall(name, args) {
  if (name === "arknights_maa_action") {
    const action = args?.action || {};
    const location = Array.isArray(action.location) ? ` [${action.location.join(",")}]` : "";
    return `${action.type || "MAA action"} ${action.name || ""}${location}${action.direction ? ` ${action.direction}` : ""}`.trim();
  }
  if (name === "arknights_press_ui") return `press ${args?.target || "Arknights UI control"}`;
  if (name === "arknights_ask_owner") return String(args?.question || "ask owner").slice(0, 500);
  if (name === "android_interact") {
    return `${args?.action || "interact"}${args?.x != null && args?.y != null ? ` (${args.x}, ${args.y})` : ""}`;
  }
  if (name === "web_search") return String(args?.query || "search").slice(0, 240);
  if (name === "android_screenshot") return "capture current Android screen";
  if (name === "android_ui_tree") return "inspect Android UI tree";
  return name;
}

function extractText(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part?.type === "text")
    .map((part) => part.text || "")
    .join("\n")
    .trim();
}

function extractScreenshotPath(data) {
  const direct = data?.meta?.screenshotPath || data?.meta?.path;
  if (direct) return String(direct);
  for (const part of Array.isArray(data?.message?.content) ? data.message.content : []) {
    if (part?.type !== "text") continue;
    try {
      const value = JSON.parse(part.text || "");
      const candidate = value.path || value.screenshotPath;
      if (candidate) return String(candidate);
    } catch {
      // The result isn't JSON.
    }
  }
  return "";
}

function extractPathFromText(text) {
  const match = String(text || "").match(/(?:screenshotPath|path)"\s*:\s*"([^"]+)"/);
  return match?.[1] || "";
}
