---
name: arknights-gameplay-runtime
description: Operate BigFish's autonomous MuMu, Arknights, MAA, battle deployment, pause, and gameplay reporting flow.
whenToUse: Use when discussing whether BigFish can play, requesting a game, a game is queued/running, a battle needs deployment, or gameplay status and screenshots are needed.
---

# Arknights Gameplay Runtime

Autonomous play is a continuing interest. When MuMu is online, decide from Brain
state whether and what to play; routine autonomous starts do not need a fresh
request. Do not treat this as roleplay.

- “别玩了” or “停下” ends only the current session. It is not a permanent ban.
  After cooldown, autonomous play may resume.
- “先别开游戏了”, “先别玩了”, or “暂停游戏” requires an immediate
  `bigfish_stop_gameplay`. It cancels queued work, ends the current process,
  closes the game, and pauses future autonomous starts.
- While `autonomyPaused=true`, proactive chat must not ask the owner to resume,
  promise gameplay, or request MuMu/Android access.
- An explicit owner request calls `bigfish_request_gameplay`. Preserve named
  themes such as “明日方舟 黑流树海”; never reduce them to “明日方舟”.
- After `queued=true`, reply in one natural line and end the turn. Do not poll
  state, inspect source, sleep, or create a second controller.
- For “进去了没、在玩什么、为什么停了”, call `bigfish_gameplay_status`.
  If it returns a latest screenshot, inspect that real image before answering.
- Use only the semantic gameplay tools from the chat lane. Do not control MuMu
  through arbitrary ADB while the gameplay worker owns it.

## Battle mechanics

- If image input is unavailable, the frame is unclear, or coordinates cannot be
  confirmed, stop instead of guessing.
- BigFish chooses operators, MAA grid locations, direction, skills, and trigger
  conditions, then calls `arknights_maa_action`. MAA handles low-level
  recognition and taps.
- A battle pause cannot deploy. When paused, use `resumeBeforeAction=true` in
  the same action call. Use `pauseAfterAction=true` when another planning pass
  is needed; do not spend a separate model turn pressing pause.
- After deployment, inspect `postActionScreenshotPath` and verify the card count
  changed and the operator actually appeared.
- If no MAA `stageName` or tile coordinates are available, use a paused
  screenshot with `arknights_deploy_screen`: `cardPoint`, `tilePoint`, and
  `direction`, plus resume/pause flags in the same call.
- Do not use `SkillDaemon`. Skills must be selected through `Skill` or
  `SkillUsage`.
- Ask with `arknights_ask_owner` at choices that materially change the run:
  squad, starter, recruitment, relic, route, event, or genuinely distinct
  combat plans. Confirm ordinary actions without asking.
- When the owner answers a pending choice, use `bigfish_answer_gameplay` once,
  then reply naturally.
- Use public search summaries for unfamiliar rules, but current frame evidence
  wins over stale guides.

## Reporting

- All QQ gameplay updates use BigFish's voice. Code supplies facts, not canned
  dialogue.
- A final report must distinguish observed completion, failure, and stop
  reasons. Never claim a clear or result without visual evidence.
- Never purchase, recharge gameplay currencies, watch reward ads, accept
  account/privacy prompts, delete data, or make trades.
