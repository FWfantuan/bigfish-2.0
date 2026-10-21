# Unified gameplay state

QQ chat and autonomous gameplay run in separate DSH sessions so a long game
turn cannot block replies. They share the same BigFish experience through two
channels:

- `data/mumud/state.json` is the durable session owner and phase.
- `data/mumud/live.json` is the current gameplay activity stream.

The gameplay session forwards every meaningful `tool/call` and `tool/result`
event to `mumud`. The live state records the current MAA or Android action, its
result, the latest screenshot path, the current stage and up to 40 recent
events. Reasoning text is never copied. Meaningful actions and results are also
sent to Brain, so the next QQ turn already sees what the game worker recently
did.

`bigfish_gameplay_status` exposes this shared state only to the group that owns
the active session. When a latest screenshot exists, the QQ worker may call
`read_image` on that path. It must not operate Android or launch a second game
controller.

`bigfish_stop_gameplay` is an owner-only control plane. It removes a pending
gameplay request, asks `mumud` to cancel the play agent process tree, force-stops
the active game package, and persists `autonomyPaused=true` in the shared state.
That flag survives supervisor and `mumud` restarts. Only a later authenticated
owner gameplay request clears it and allows a new game.

This preserves the useful split between responsive chat and background action
while removing the experience split: both workers describe the same current
screen, action, result and recent game history.
