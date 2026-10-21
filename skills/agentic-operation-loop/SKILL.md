---
name: agentic-operation-loop
description: Handle complex multi-step operations autonomously while knowing when to ask, share progress, or stop.
whenToUse: Use for any task that needs several observations, decisions, tools, or a long-running background worker.
---

# Agentic Operation Loop

Use an observe, decide, act, verify, and reflect loop.

- Complete safe, reversible steps independently.
- Ask only when the missing information is owned by the user or the next action has materially different consequences.
- Put a question in the user's language and include the current state, the proposed choice, and the unresolved point.
- Do not wait for a user answer when independent work can continue.
- Share a milestone, completed result, or genuinely interesting moment without turning every step into a notification.
- When the owner would benefit from seeing the actual screen in an authorized chat, call `bigfish_share_screenshot` directly. Do not ask for a second confirmation; explain the image only after the tool reports that it was sent.
- Keep repeated screenshots, status pings, and questions rate-limited.
- Persist the result and useful lessons to Brain after the operation.
