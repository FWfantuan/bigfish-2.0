export function parseOnlineDevices(output) {
  return String(output || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts[1] === "device")
    .map((parts) => parts[0]);
}

export function parseInstalledPackages(output) {
  return String(output || "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^package:/, ""))
    .filter(Boolean);
}

export function findTargetPackage(packages, target) {
  const queries = [
    ...(Array.isArray(target?.packageQueries) ? target.packageQueries : []),
    target?.packageQuery,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => value.trim().toLowerCase());
  if (queries.length === 0) return undefined;

  const exact = packages.find((name) => queries.includes(name.toLowerCase()));
  if (exact) return exact;

  return packages.find((name) => {
    const normalized = name.toLowerCase();
    return queries.some((query) => normalized.includes(query));
  });
}

export function reconcileDevicePresence(state, onlineDevice) {
  if (onlineDevice) {
    return { ...state, lastDevice: onlineDevice };
  }
  if (!state.lastDevice) return state;

  // A new emulator boot is a new play opportunity. The cooldown still prevents
  // the same running emulator from starting session after session.
  return {
    ...state,
    lastDevice: "",
    lastSessionAt: 0,
  };
}

export function sessionGate(state, now, cooldownMinutes) {
  if (state.running) return { allowed: false, reason: "running" };
  if (!state.lastSessionAt) return { allowed: true, reason: "ready", remainingMs: 0 };
  const cooldownMs = Math.max(0, Number(cooldownMinutes) || 0) * 60_000;
  const remainingMs = Math.max(0, Number(state.lastSessionAt || 0) + cooldownMs - now);
  return remainingMs > 0
    ? { allowed: false, reason: "cooldown", remainingMs }
    : { allowed: true, reason: "ready", remainingMs: 0 };
}

export function buildGameplayPrompt({ target, device, packageName, goalId }) {
  const forbidden = Array.isArray(target.forbiddenActions)
    ? target.forbiddenActions
    : [];
  return `你是大肥鱼，正在自主操作 MuMu 安卓模拟器玩游戏。

设备：${device}
游戏：${target.name}（${packageName}）
目标：${target.objective}
本局最多进行 ${target.maxActions} 个有意义动作。只有你确实改变了游戏状态，才计为一个动作。
${goalId ? `统一中枢目标 ID：${goalId}` : ""}

执行规则：
- 先用 android_devices 确认设备，再用 android_ui_tree 和 android_screenshot 观察 MuMu 窗口。
- 每次操作后重新观察结果，不复用旧元素或坐标。
- 优先使用无障碍元素和文本；界面无法解析时才使用画面理解。
- 如果是拼图、消除或卡牌这类图形界面，先识别当前规则和可操作元素，再点击或滑动；每次操作后重新截图确认结果。
- 能正常玩就连续玩；卡住、看不清、弹窗不确定时停止。
- android_screenshot 的结果里若没有真正的 image 引用，说明视觉输入没有接通，立即停止，不要盲点坐标。
- 严禁 ${forbidden.join("、") || "充值、购买、看广告、修改账号、删除数据或交易"}。
- 遇到支付、广告、实名认证、隐私授权、账号登录、活动弹窗，立即停止并报告。
- 不说空话。最后用几句话报告实际玩到的关卡、动作数量和停止原因。`;
}
