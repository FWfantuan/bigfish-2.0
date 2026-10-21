---
name: device-control
description: Use browser, native desktop, and Android tools through an observe-act-verify loop.
whenToUse: Use when the user asks the agent to inspect or operate a browser, desktop application, emulator, or Android device.
---

# Device Control

Prefer the browser tools for websites, the native Cua tools for desktop
applications, and `android_*` tools for Android devices.

Always observe before acting. After each meaningful action, inspect the new
screen or page. Do not reuse stale elements, coordinates, or page references.

Browser operations should stay in the dedicated BigFish profile so logins
persist across tasks. Desktop and Android actions should be limited to the
requested task. Stop and ask for confirmation before deleting data, sending
sensitive information, submitting a form with external consequences, making a
purchase, changing access, or bypassing a security barrier.

For Android, discover the serial with `android_devices` first. Type non-ASCII
text only through a supported IME; if the tool refuses, report the requirement.
