# MAA gameplay engine

BigFish uses the user's installed MAA as an optional external engine for
Arknights. The agent still decides whether and what to play, while MAA handles
the fast recognition and action loop that the vision model is poor at.

The useful ideas adopted from MAA are:

- a fixed, verified screen resolution;
- ROI-local template matching, OCR, color and feature recognition;
- a task graph where each recognized state leads to a known next state;
- actions followed by a new observation instead of replaying stale coordinates;
- explicit retries, timeouts, error callbacks and stop conditions.

BigFish does not copy or reimplement MAA. MAA and maa-cli are AGPL-3.0-only
projects, so they remain separate user-local executables. The adapter only
starts `maa-cli`, observes its exit status and logs, and records the result in
BigFish Brain.

## Installed layout

The current default follows the normal Windows MAA layout:

```text
%USERPROFILE%\Desktop\maa\MAA.exe
%USERPROFILE%\Desktop\maa\MaaCore.dll
%USERPROFILE%\Desktop\maa\resource\
%USERPROFILE%\Desktop\maa\maa.exe
```

Set `MAA_ROOT` to another MAA directory or `MAA_CLI_PATH` to a separately
installed `maa.exe` when needed. BigFish keeps maa-cli configuration, state,
cache and logs under this repository:

```text
config/maa/
data/maa/state/
data/maa/cache/
data/maa/logs/
```

Install the pinned, checksum-verified CLI next to an existing MAA v6
installation with:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/install-maa-cli.ps1
```

## Safe task boundary

The only mapped game task is `arknights-safe` for
`com.hypergryph.arknights`. It performs `StartUp` and one `Fight` with:

- `medicine = 0`;
- `stone = 0`;
- `times = 1`;
- `series = 1`;
- no uploads to Penguin Statistics or Yituliu.

When the owner explicitly asks for Integrated Strategies, one of five bounded
theme labs is selected: JieGarden, Sarkaz, Sami, Phantom or Mizuki. A generic
"肉鸽" request uses JieGarden, while a named theme selects that theme. Every lab
runs at most one exploration, disables Originium Ingot investment and avoids
paid currency, purchases and support recruitment.

The first two actions remain `StartUp` and `Roguelike`. A task that only reaches
the theme overview because another theme is active is recorded as
`meaningful: false`; it never contributes learning evidence. A run becomes a
valid sample only after MAA logs `Start exploration` or starts a combat.

The model cannot provide an arbitrary MAA task name, JSON pipeline, stage
parameters or callback. `config/gameplay.json` maps packages to fixed task IDs,
and `taskAllowlist` is checked twice: before dispatch and inside the adapter.
The `mall`, `recruit`, `award`, gacha, purchase and account tasks are not
exposed.

MAA requires landscape `1280x720` or `1920x1080`. `mumud` reads `wm size` before
dispatch. If MAA or the resolution is unavailable, the configured fallback uses
the isolated visual `bigfish-play` worker. A task that has already started and
then fails is recorded and stopped instead of being replayed by a second engine.

## Runtime result

`data/mumud/status.json` reports the detected maa-cli and MaaCore versions,
safe task allowlist, resolution check and last engine used. The full MAA output
tail and log path are retained in the Brain session. QQ only receives a short
BigFish-style result so the group does not get a technical report.

Roguelike learning records include theme, mode, squad, difficulty, run limit,
investment policy, task completion, battle lines, errors and filtered node or
recruitment evidence. Generic Brain reflection turns repeated evidence into
candidate `arknights_roguelike` skills. Those skills require at least five
observed uses, three successes and a 60% success rate before activation, which
reduces the chance of treating one lucky run as a permanent strategy.
