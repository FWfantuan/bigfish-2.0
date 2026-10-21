# Autonomous MuMu gameplay

`services/mumud` watches the MuMu ADB device and starts one configured game when the emulator becomes available. After the owner opens MuMu and installs the configured game, no additional chat command is needed.

```text
MuMu ADB device online
  → check game package
  → launch game
  → notify owner in the whitelist group
  → bigfish-play vision agent observes and acts
  → stop on success, uncertainty, or forbidden dialog
  → write the session to BigFish Brain
```

The isolated `bigfish-play` profile contains Android ADB tools, but no shell, filesystem, web, subagent, or desktop-control tools. Approved desktop actions stay in the normal BigFish profile; the autonomous game worker can only touch the detected Android device.

`deepseek-v4-flash-vision-exp` must be present in the profile's DeepSeek model catalog with `inputModalities: [text, image]`. `pnpm dsh:patch` installs that catalog declaration idempotently. This is required because the Android screenshot tool only returns a real model-visible image block when the active route declares image input.

The worker starts one game session per online emulator session. A 60-minute cooldown prevents repeated sessions while MuMu stays open. Taking MuMu offline clears the previous session timestamp, so closing and reopening the emulator gives BigFish a new opportunity to play.

If the game is missing, `mumud` keeps polling and reminds the owner at most once every six hours. Installing the game while MuMu stays online is enough for the next poll to detect it and begin a session.

Forbidden actions are refused by the prompt and agent profile: purchase, recharge, rewarded ads, membership, account changes, data deletion, and trades. If the agent can identify one of those dialogs, it must stop.

`config/gameplay.json` controls which game, if any, may start automatically. The repository intentionally ships with no default target. A game mentioned in conversation is only an example unless its package and objective are added to `targets`.

Each target needs these fields:

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
