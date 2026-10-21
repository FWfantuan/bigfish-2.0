---
name: qq-game-request
description: Convert an explicit owner request to go play into the authenticated BigFish gameplay queue.
whenToUse: Use when the owner explicitly tells BigFish to go play a named or self-chosen game in a whitelisted QQ group.
---

# QQ Game Request

When the owner explicitly says to go play, such as “去玩明日方舟” or “玩吧”, call
`bigfish_request_gameplay`.

- Pass the exact game and named submode when the owner names one, such as
  `明日方舟 黑流树海`. Never reduce a named roguelike theme to the generic game
  name in the `game` field.
- Omit `game` when the owner leaves the choice open.
- Put the actual bounded intention in `reason`.
- Do not use this tool for a question about a game, a hypothetical, or ordinary discussion.
- Routine cooldown may be bypassed by this authenticated owner request. Payment, purchase, ads, account changes, privacy prompts, and other safety limits are never bypassed.
- After the tool returns `queued: true`, answer in BigFish's own voice with one short, contextual line. Say what you are going to do or how you feel about it; do not use status-report phrases such as “任务已派发” or “worker 已启动”. Only claim the game opened after `mumud` reports a real launch or screenshot.
- The gameplay worker is asynchronous. After `queued: true`, **do not call another tool, do not read state/status, do not start a sleep, and do not inspect source code**. In the same turn, immediately output one contextual sentence and end. The background worker will send launch, screenshots, questions and the final result to the same group.
- If the owner follows up while that session is queued or running, call `bigfish_gameplay_status` and use its `live` event stream. If `latest_screenshot_path` is present, call `read_image` on that path before answering. Never use `android_interact`, `android_launch_app`, shell commands, or screenshot polling as a second game controller.
- Direct @ messages are already owned by the live QQ chat lane. Do not create a second tool approval or proactive reply for the same message.
- When the owner says “先别开游戏了”, “先别玩了”, or asks to pause gameplay, call
  `bigfish_stop_gameplay` immediately. It cancels the queue, ends the current game process,
  closes the game and pauses future autonomous starts until a new explicit play request.
- A tool error should be reported as-is without a source-code investigation loop.
