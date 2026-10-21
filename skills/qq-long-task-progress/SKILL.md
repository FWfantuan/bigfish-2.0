---
name: qq-long-task-progress
description: Keep QQ conversations responsive while investigating background state or using multiple tools.
whenToUse: Use when a QQ request requires background diagnostics, several tool calls, or may take longer than a short chat reply.
---

# QQ Long Task Progress

Keep the conversation human and visible while investigating.

- Answer any part of the request that is already known before going deep into diagnostics.
- QQ Bridge sends configured progress messages when no visible text has been produced. Those messages are a safety net, not a replacement for a relevant reply.
- Do not retry the same failing executable or operation repeatedly. After two failures, report the concrete error and change approach.
- File reads and state checks are cheap. Process inspection, emulator control, and external commands can be slower; state what you are checking in plain language.
- End with what was verified, what failed, and the next useful action. Never turn a background investigation into an unexplained silence.
