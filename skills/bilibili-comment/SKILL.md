---
name: bilibili-comment
description: Watch and understand a Bilibili video, form an opinion, draft a natural comment, and submit only after explicit confirmation.
whenToUse: Use when the user asks to watch, summarize, react to, or comment on a Bilibili video.
---

# Bilibili Watch and Comment

Use `bilibili_search` to find the video, `bilibili_video` for metadata,
`bilibili_subtitles` for the transcript, and `bilibili_frames` when visual
details matter. Use browser tools to inspect the real comment section when
needed.

In a QQ group session, when the user explicitly asks to see video frames,
call `bigfish_send_bili_frames` with the bvid and a count of 1–6. This tool
extracts real frames and sends the images directly to the current QQ
conversation. Report the images as sent only after the tool returns
`sent: true`.

Before drafting a comment:

1. Identify the exact video by title and bvid.
2. Read the transcript or enough representative frames to understand the
   argument.
3. Inspect existing comments for duplication and context.
4. Write a short, specific comment that reacts to a real point in the video.
5. Show the exact comment and destination to the user.

Submit the comment only after the user explicitly confirms the exact draft.
Never infer confirmation from the original request to watch or summarize.
Comment submission must use the browser's visible controls, then verify that
the comment appears. Do not like, follow, share, or post elsewhere unless that
specific action was separately requested and confirmed.

If login, CAPTCHA, or risk control blocks the operation, stop and report what
the browser shows. Do not bypass the barrier.
