# Autonomous MuMu gameplay

`services/mumud` watches the MuMu ADB device. After MuMu becomes available, BigFish can inspect the device and decide for itself whether and what to play. No game is prescribed when `targets` is empty and autonomous choice is enabled.

Arknights no longer automatically dispatches a MAA daily task or follows the
game's current/last stage. Generic and roguelike requests use the isolated
vision worker as the decision maker: BigFish chooses what to play, the squad, recruitment,
relics, route, deployment tiles, facing directions and skill plan. MAA's
monolithic Roguelike tasks are not executable in this profile. During combat,
the isolated worker calls `arknights_maa_action`; this creates a temporary MAA
`SingleStep` task, uses MAA's tile mapping and recognition, and runs it with
`deployment_with_pause=false`. The worker resumes a paused battle before
deployment and verifies the operator placement from the next screenshot. See
[MAA gameplay engine](maa-gameplay-engine.md).

```text
MuMu ADB device online
  → load Brain mood, goals, facts, skills and reflections
  → inspect screenshot, UI tree and third-party app list
  → choose an installed game or decide not to play
  → launch the chosen package
  → decide what content to play instead of following a fixed MAA daily task
  → continue the same reasoning session and play
  → write the choice, reason, actions and result to Brain
  → stop on success, uncertainty, or forbidden dialog
  → write the session to BigFish Brain
```

The isolated `bigfish-play` profile contains Android ADB tools, but no shell, filesystem, web, subagent, or desktop-control tools. Approved desktop actions stay in the normal BigFish profile; the autonomous game worker can only touch the detected Android device.

The game profile may use DeepSeek `web_search` without owner approval for public rules, terminology, UI meanings, and level guides. It receives search summaries only: webpage fetching, long-form guide reading, browser use, and video guides remain outside this profile.

The QQ chat route and gameplay route are separate. The QQ session may use a text-only model while `bigfish-play` uses the vision model. `services/mumud` publishes the authoritative split and current capability flags to `data/mumud/status.json`, which the QQ agent must read before claiming that the game worker cannot see screenshots or needs OCR.

`deepseek-v4-flash-vision-exp` must be present in the profile's DeepSeek model catalog with `inputModalities: [text, image]`. `pnpm dsh:patch` installs that catalog declaration idempotently. This is required because the Android screenshot tool only returns a real model-visible image block when the active route declares image input.

The worker starts at most one play decision per online emulator session. A 60-minute cooldown prevents repeated decisions while MuMu stays open. Taking MuMu offline clears the previous session timestamp, so closing and reopening the emulator gives BigFish a new opportunity to decide.

The full tool trajectory and factual report are retained for Brain learning, but the QQ group receives only the play agent's `QQ_SUMMARY` line. The prompt asks for 1–3 short, casual sentences in BigFish's voice without Markdown headings, action-count lists or task-report formatting. There is no automatic “game launched” message and no fixed opening narration.

An explicit owner request is different from the routine autonomous cooldown. The QQ tool `bigfish_request_gameplay` verifies the current group and the platform-provided `is_owner=true` identity before writing a short-lived request to `data/mumud/request.json`. Any group in `BIGFISH_ALLOWED_GROUPS` is accepted. `mumud` atomically consumes that request, bypasses routine cooldown, and records it in Brain. The request's own `groupId` becomes the session target, so launch messages, screenshots, strategic questions and final results return to that same group. Safety rules are not bypassed.

During a longer session, a read-only observer checks the real screen after the initial delay and at the configured interval. It stays quiet for ordinary progress, shares a screenshot when a visible moment is genuinely worth showing, and asks the owner when a decision is truly blocked. Duplicate images are suppressed. `maxShares: 0` means there is no fixed share-count cap; the model still follows the no-spam rule and the configured interval.

The main play worker asks much earlier than a tool failure. Opening squad, starting operators, recruitment, unfamiliar relics, route/event choices, and materially different combat plans can call `arknights_ask_owner`. That creates a pending question, sends its real screenshot to the owner, and pauses the choice. The owner's QQ reply is passed through `bigfish_answer_gameplay`, written back to `data/mumud/question.answer.json`, and the waiting game resumes with that answer. Trivial actions and clear decisions continue autonomously.

The QQ chat route can also call `bigfish_share_screenshot` directly. In an owner conversation in a whitelisted group, or in owner private chat, no second confirmation is requested: the tool captures the current online ADB device, saves a local copy, and sends the image to that conversation. Non-owner and out-of-whitelist calls are rejected.

Game start, stop, failure and completion reports use the same real-screen image path, so a summary is not sent as text by itself. If the screenshot fails, the report includes the concrete capture error.

Every automatic game message is written by the `bigfish-social` model from an event plus structured facts and the current Brain state. `mumud` contains no user-facing catchphrase for autonomous launch, skip, missing game, MAA completion or failure; if the message model fails after one retry, the event is logged rather than replaced with a canned line.

Install `scripts/install-mumud-supervisor.ps1` once. It places a hidden startup launcher in the user's Startup folder and starts `scripts/run-mumud-supervisor.ps1`. The supervisor holds a single-instance mutex and restarts `pnpm play:start` after every unexpected exit.

Named games can be mapped to their installed package in `gameAliases`. When an owner request exactly matches a configured alias and that package is installed, the worker starts it directly instead of spending another model turn deciding whether to play it. The autonomous choice path remains for open requests such as “随便玩”.

`pnpm dsh:patch` repairs the Android plugin's no-stream fallback by reading `SurfaceOrientation`, which prevents horizontal taps from drifting toward the upper-left on MuMu. If coordinates still drift, the play worker may call `android_boot` once to switch to the live landscape frame.

The same patch adds two semantic Arknights tools. `arknights_press_ui` presses fixed 16:9 UI anchors such as the recruitment confirmation button and verifies that the frame changed. `arknights_maa_action` accepts one BigFish-chosen battle action and submits it to MAA Core as a validated `SingleStep` task. The tool rejects `SkillDaemon`, arbitrary strategy tasks, purchases and account actions.

If the game is missing, `mumud` keeps polling and reminds the owner at most once every six hours. Installing the game while MuMu stays online is enough for the next poll to detect it and begin a session.

Forbidden actions are refused by the prompt and agent profile: purchase, recharge, rewarded ads, membership, account changes, data deletion, and trades. If the agent can identify one of those dialogs, it must stop.

`config/gameplay.json` controls the boundaries, not the preferred game. The repository ships with no fixed target. `autonomy.enabled=true` lets BigFish choose from clearly identifiable installed games. A non-empty `targets` array explicitly pins one or more games and disables the free-choice branch for the first target.

```json
{
  "autonomy": {
    "enabled": true,
    "notifyOnSkip": false,
    "decisionTimeoutMinutes": 10,
    "maxSessionMinutes": 12,
    "maxActions": 30,
    "webSearch": true,
    "objective": "像自己真心想玩一样探索当前游戏，卡住或界面不确定就停。"
  },
  "targets": []
}
```

An explicitly pinned target needs these fields:

```json
{
  "name": "显示名称",
  "packageQuery": "package-fragment",
  "packageQueries": ["full.package.name", "package-fragment"],
  "maxSessionMinutes": 12,
  "maxActions": 30,
  "objective": "这个游戏希望做到什么，何时停止",
  "forbiddenActions": ["充值", "购买", "看广告领奖励"]
}
```

Run the deterministic checks with:

```powershell
pnpm play:test
pnpm social:test
```
