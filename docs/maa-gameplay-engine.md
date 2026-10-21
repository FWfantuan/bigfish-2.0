# MAA gameplay engine

BigFish uses the user's installed MAA as an optional external engine for one
ordinary Arknights safe task. Roguelike strategy remains BigFish's own
decision: the profile does not execute MAA's autonomous Roguelike tasks.

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

When the owner asks for Integrated Strategies, `mumud` resolves the request to
the `arknights-roguelike` agentic gameplay mode and calls the isolated visual
worker without dispatching a MAA Roguelike task. BigFish makes the squad,
recruitment, relic, route and battle decisions. It pauses combat before a
deployment decision, observes and acts in small verified steps, then briefly
resumes only to observe DP or enemy movement.

Inside combat the worker calls `arknights_maa_action`. This tool validates one
Copilot action selected by BigFish, writes it into a temporary MAA `SingleStep`
task, and runs MAA Core with a generated `bigfish-actions` profile whose
`deployment_with_pause` option is enabled. MAA therefore performs the reliable
operator recognition, tile mapping and touch sequence while BigFish still owns
the operator name, logical tile, direction, skill timing and conditions.

`SkillDaemon` is deliberately blocked. An action may be `Deploy`, `Skill`,
`Retreat`, `SpeedUp`, `BulletTime`, `SkillUsage` or `SetUnitLocation`; static
confirmation buttons use the separate `arknights_press_ui` tool.

MAA resources may be read as knowledge and low-level recognition/action ideas,
but `arknights-roguelike-*` task IDs are not present in the executable
allowlist. This prevents MAA from silently making the strategic choices that
belong to BigFish.

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

Agentic roguelike sessions record the actual decisions, failures, reasons for
asking and verified outcomes in Brain. Reflection can turn repeated evidence
into candidate `arknights_roguelike` skills. Those skills require at least five
observed uses, three successes and a 60% success rate before activation, which
reduces the chance of treating one lucky run as a permanent strategy.
