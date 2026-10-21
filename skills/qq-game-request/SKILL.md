---
name: qq-game-request
description: Convert an explicit owner request to go play into the authenticated BigFish gameplay queue.
whenToUse: Use when the owner explicitly tells BigFish to go play a named or self-chosen game in a whitelisted QQ group.
---

# QQ Game Request

When the owner explicitly says to go play, such as “去玩明日方舟” or “玩吧”, call
`bigfish_request_gameplay`.

- Pass the game name when the owner names one.
- Omit `game` when the owner leaves the choice open.
- Put the actual bounded intention in `reason`.
- Do not use this tool for a question about a game, a hypothetical, or ordinary discussion.
- Routine cooldown may be bypassed by this authenticated owner request. Payment, purchase, ads, account changes, privacy prompts, and other safety limits are never bypassed.
- After the tool returns `queued: true`, tell the owner that the play worker has been dispatched. Only claim the game opened after `mumud` reports a real launch or screenshot.
