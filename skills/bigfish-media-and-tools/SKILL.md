---
name: bigfish-media-and-tools
description: Route BigFish QQ image, meme, Nailong, screenshot, Bilibili frame, DeepSeek balance, token usage, and support-payment requests through the correct tools.
whenToUse: Use when a QQ request asks for an image, meme, Nailong, screen or video frame, owner-only DeepSeek usage, a support QR, or another BigFish-specific media tool.
---

# BigFish Media And Tools

## Images and memes

- “龙来”, “来只奶龙”, “发射奶龙”, or an explicit request for a Nailong calls
  `bigfish_send_meme` with `kind=nailong`.
- “来个表情包” or another explicit general meme request calls
  `bigfish_send_meme` with `kind=meme`.
- Send only the image unless the user also asks for a caption. Do not embed a
  canned phrase into every meme send.
- QQ user images are saved locally by the bridge. Inspect the real image before
  commenting; never infer its contents from an image placeholder.

## Bilibili frames

- When the owner asks for a Bilibili keyframe or “让我看看画面”, call
  `bigfish_send_bili_frames`. Default to one image unless more are requested.
- Preserve the named part and timestamp. Without a timestamp, the tool chooses a
  representative point rather than the opening frame.
- Claim an image was sent only after `sent=true`.

## Screenshots

- In an authorized owner chat, `bigfish_share_screenshot` may directly capture
  and send the current game or device screen when it helps answer or show a
  real result.
- Deduplicate recent screenshots through the shared gameplay activity record.
  A tool may omit a duplicate image while still returning the factual text.

## DeepSeek usage

- Owner questions about balance, remaining credit, token burn, or context usage
  call `bigfish_deepseek_usage`.
- Balance is the official API wallet value. Token totals are persisted
  provider-reported DSH usage; never present a heuristic estimate as a bill.

## DeepSeek support

- A whitelisted-group support request calls `bigfish_support_deepseek`.
  Default to ¥10; pass amount 10, 20, 50, 100, 300, or 500 when explicitly
  requested.
- The tool creates a fresh unpaid order and sends only its short-lived payment
  QR. State that support is voluntary, the code expires, and payment goes to
  the owner's DeepSeek API balance.
- If DeepSeek login has expired, do not send a login QR to a group. Tell the
  owner to refresh it privately with `bigfish_deepseek_login`.
- Never invent a payment link, claim payment succeeded, or ask for payment
  account credentials.

## External effects

Comments, posts, deletion, payment, authorization, account changes, and setting
changes require an exact draft and explicit owner confirmation before execution.
