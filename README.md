<div align="center">

<!-- Localization -->

<img src="assets/nii-logo-square.svg" width="120" alt="NII logo">

# NII — Nothing Is Impossible

### Give OpenCode the taste of determination to attempt and solve Impossibly Possible tasks.

[![npm version](https://img.shields.io/npm/v/opencode-nii)](https://www.npmjs.com/package/opencode-nii)
[![npm downloads](https://img.shields.io/npm/dt/opencode-nii)](https://www.npmjs.com/package/opencode-nii)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
[![OpenCode V2](https://img.shields.io/badge/OpenCode-V2-7c3aed)](https://opencode.ai)
[![GitHub stars](https://img.shields.io/github/stars/velo4705/nii?style=social)](https://github.com/velo4705/nii)

</div>

See your AI agent giving up on something you thought is possible? NII clears the road by allowing two simple features - Determination and Self-Evolution, to carry out the task without giving up via finding new methods to work while not trying to use the current one all the time.

## Why

In both Research and Engineering, Many AI agents always hit on hard dead ends where the problem that seems possible to solve, becomes impossible to finish. AI Agents tend to fail by always giving up mid-way through the session, by an interruption or using the same method all the time.

To address this, NII is simply built to counter-attack these problems that motivates the session to keep working hard, and if one fails, it self-evolves and finds a different method - almost as if it were backtracking to reach the end. It makes persistence explicit, which requires different attempts to solve the project or a problem through observable evidence. 

It is deliberately *bounded*. NII is not an infinite-retry loop where it goes on after solving a particular task.

## What it does

### 1. Adaptive mandate

The `context` hook injects a directive into every agent-loop model call, including tool continuations. It has four levels:

- Steady: the base mandate when nothing is wrong.
- Nudged: the same tool action has failed repeatedly in the recent window.
- Escalated: failures passed the threshold, a pivot has happened, or the agent said it cannot do the task. Stop tweaking parameters, name the blocker, pick an unused playbook move, and verify the smallest step.
- Stop: the pivot budget is gone. Report with evidence and ask before continuing.

Every level keeps the same rules: treat "impossible" as "not yet solved with the current approach," try genuinely different methods, and require passing tests, a working artifact, or a cited source.

Quit signals in assistant text fall into four families. The plugin reads them from `session.text.ended`:

| Signal | Examples |
|---|---|
| refusal | "I can't do this", "this is impossible" |
| handoff | "you'll need to do this manually", "I give up", "we need a human" |
| partial | "that's all I can do", "here's a partial solution" |
| uncertainty | "I don't know how to proceed", "beyond my capabilities" |
| stall | "I'm stuck", "I'll stop here", "no point in trying", "this is a dead end" |

The same signals are scanned in user prompts. If you write "I can't make it", NII injects a directive into that prompt telling the agent to restate the blocker and try at least three unused approaches. Two signals, or one plus a real tool failure, bring in a quit-specific mandate. A single stray phrase does nothing on its own. A separate success-claim detector watches for "Done!", "that should work", and "all tests pass" while failures remain in the window. It asks for evidence before the task can end, and a successful tool call clears it. When a pivot fires, the message asks the agent to restate the goal and name the one piece of evidence that would prove it done.

A genuine blocker in tool output (permission denied, 401/403, missing credentials) outranks every persistence tier. Pivoting stops and the agent reports the blocker and asks the user. When the blocker is real, stopping is the right result.

### 2. Auto-invoked playbook skill

The `nii` skill holds the recovery loop and the strategy moves. It checks that a new move is actually different from earlier ones, treats an honest stop with evidence as a valid use of the skill, and lists the anti-patterns: cosmetic retries, unverified victory claims, and spinning without recording what was ruled out.

Failure detection uses a window. A non-zero shell exit counts as a failure, even from a plain `cat`. The same failure twice in a row triggers a pivot right away. Older outcomes drop out of the window; unrelated successes do not erase them.

### 3. Bounded strategy pivot

Failures are counted per session in a rolling window. Three failures, or the same failure twice, make the coach generation read the recorded signatures and propose one genuinely different method. The plugin injects it as a synthetic message.

Two things keep this bounded:

- If the coach is unavailable or proposes something too close to what was tried, the playbook supplies a deterministic fallback pivot.
- A failed pivot marks its strategy ineffective for those failures, so later coaches avoid it.

There is no default pivot ceiling. The agent keeps generating different approaches until one works or a genuine blocker appears. `maxPivots` is only there if you want a hard stop for your own reasons; `0` means unlimited. Three failed approaches is the floor for concluding anything, not the ceiling. `/nii reset` clears any cap you set.

An interrupted session keeps its place. Streaks, pivot claims and learned strategies live in durable storage, so answering "continue" picks up the same journey instead of starting over. If a pivot was claimed but not delivered, the next model call replays that exact proposal.

The plugin claims a pivot in durable state before delivery. It spends the budget only after the synthetic message is accepted. If a rate limit or provider error interrupts the process in between, resuming the same session replays that proposal rather than spending a pivot with nothing delivered. A per-session async lock stops concurrent model calls from delivering two different pivots.

The retry hook handles provider errors within bounds. It extends OpenCode's policy for 429s and transient 5xx or transport failures with exponential backoff, a capped delay, and at most three retries. Clearly permanent 4xx failures are vetoed so they cannot burn attempts. OpenCode's hard attempt limit still applies.

### 4. Bounded case-matrix validation

Each pivot carries a validation directive. It asks for at most seven cases across four kinds:

1. Trivial or dumb input: the simplest or absurd case. Failing here discards the method.
2. Typical input: the actual shape of the task.
3. Boundary input: the edge that broke earlier attempts.
4. Adversarial or "impossible" input: a case the method should fail gracefully. Success here is a warning sign.

The agent names each case and reports what the tools returned. Reasoning alone does not count. The plugin detects the reported categories in assistant text and stores them with the strategy as confidence (the share of the four categories covered) and explicit bounds. The only proof a strategy has is the cases in its matrix. Later sessions see those bounds in coach hints and have to check whether the new task fits them.

### 5. Persistent learning

A pivot followed by a successful tool call stores the strategy against the failure signatures that caused it. In later sessions of the same project, matching failures offer that strategy to the coach as a hint. Memory stops at 50 entries. Strategies that get reinforced survive; among equal-ranked ones, the oldest is dropped. `/nii status` reports the count.

State is scoped to the project. You can install the plugin once globally, but its enable switch, failure streaks, and learning store stay keyed to a project id or directory. Strategies learned in one repo cannot leak into another. Set `shareLearning: true` in plugin options to use one shared store.

### 6. Bounded escape hatch

The mandate names the blockers where the agent should stop and report with evidence:

- a missing credential, permission, or capability;
- an explicit user constraint forbidding the needed action;
- a proven physical or mathematical limit;
- an irreversible or high-risk action needing human approval.

When the blocker is real, stopping is the right result.

## Quick start

See [INSTALL.md](INSTALL.md) for the installer, global setup, and troubleshooting. Short version: plugins under `.opencode/plugins/` load automatically, with no config entry required.

```sh
cd /path/to/this/repo
opencode
```

After publication:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["opencode-nii"]
}
```

With options:

```jsonc
{
  "plugins": [
    {
      "package": "opencode-nii",
      "options": {
        "coachModel": { "providerID": "anthropic", "id": "claude-sonnet-4-5" },
        "shareLearning": false,
        "maxPivots": 0,
        "retryMaxRetries": 3,
        "retryBaseDelayMs": 1000,
        "retryMaxDelayMs": 30000
      }
    }
  ]
}
```

- `coachModel`: model used for the small strategy-coach generation. Defaults to the session's default model.
- `shareLearning`: `false` by default keeps learning scoped to the current project; `true` uses a shared global store.
- `maxPivots`: strategy pivots allowed per session. `0` (default) means unlimited; a positive number sets a cap.
- `retryMaxRetries` / `retryBaseDelayMs` / `retryMaxDelayMs`: tune the bounded retry hook. Defaults: 3, 1000 ms, and 30 000 ms.

Confirm it is active with `/nii status`.

## Commands

| Command | Effect |
| --- | --- |
| `/nii on` | Enable the mandate for this session (clears any per-session override) |
| `/nii off` | Disable the mandate for this session (kill switch) |
| `/nii reset` | Clear the failure streak and pivot budget (keeps learning) |
| `/nii status` | Show whether NII is active, pivots used, and last pivot |
| `/nii help` | Show usage |

Disabling takes effect on the next model call, because the gate lives in the `context` hook. State uses plugin-scoped durable storage, so it survives reloads and applies only to the session that changed it.

## Project structure

```
.opencode/plugins/nii/
  index.ts       # setup: skill, event subscription, context hook, /nii command
  playbook.ts    # mandate, skill content, escalation and pivot text
  state.ts       # storage-backed enable state and stuck state
  stuck.ts       # pure failure/pivot logic (thresholds, cap, coach prompt)
  learning.ts    # pure strategy-memory logic (reward, rank, cap, match)
  commands.ts    # pure /nii argument parsing
  api.ts         # compatibility shim for the one-shot generation API
  SKILL.md       # path target for the registered skill
tests/           # node:test suite
README.md
CONTRIBUTING.md
```

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the full milestone plan. Milestones 1 (core loop) and 2 (release) are done; milestones 3 to 6 cover live verification, domain depth, guardrails, and polish.

## Testing

```sh
npm test           # 126 checks (unit + session/retry/atomic/quit/validation + installer/setup/uninstall + benchmark)
npm run pack:check # inspect tarball contents
```

`tests/session.test.ts` drives full session lifecycles through the real state and learning modules: failure windows, one pivot at a time, successful and failed pivots, cross-session and cross-project learning, genuine blockers, refusal escalation, pivot-budget exhaustion, and `/nii reset`.

Node 24 has native TypeScript support, so there are no dependencies or build step.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and how to propose changes.

See [BENCHMARK.md](BENCHMARK.md) for the paired benchmark harness that compares agents with and without NII.

## License

The project has an MIT license in `LICENSE`.
