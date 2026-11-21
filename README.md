# NII — Nothing Is Impossible

An OpenCode V2 plugin that stops an agent from abandoning hard tasks — and gives it a structured way to change approach when the current one fails.

> "Impossible" means "not yet solved with the current approach."

## Status

**V3 — motivation layer + bounded stuckness recovery + persistent strategy learning: implemented and loaded.** Phase 4 (release packaging) is prepared; the package is not yet published to npm.

## Why

Engineering and research both contain tasks that *look* impossible but are solvable with a different method. Agents tend to fail in two ways: they give up after a few failed attempts, or they keep retrying the same thing with cosmetic changes. NII addresses both by making persistence explicit, requiring **genuinely different** attempts, and requiring **observable evidence** before declaring success.

It is deliberately *bounded*. NII is not an infinite-retry loop.

## What it does

### 1. Adaptive mandate

A directive is injected into every agent-loop model call (including tool continuations) via the `context` session hook. Its intensity adapts to evidence of stuckness:

- **Steady** — the base mandate when things are fine.
- **Nudged** — when the same tool actions fail repeatedly in a recent window.
- **Escalated** — when failures cross the threshold, any strategy has been pivoted, or the agent claims it cannot do something: stop adjusting parameters, name the blocker, pick an unused playbook move, verify the smallest step.
- **Stop** — when the pivot budget is spent: report with evidence and ask before continuing.

All tiers carry the non-negotiables: reframe "impossible" as "not yet solved with the current approach", try genuinely different methods, and demand passing tests, a working artifact, or a cited source.

**Quit signals in assistant text** come in four families, all detected from `session.text.ended`:

| Signal | Examples |
|---|---|
| refusal | "I can't do this", "this is impossible" |
| handoff | "you'll need to do this manually", "I give up", "we need a human" |
| partial | "that's all I can do", "here's a partial solution" |
| uncertainty | "I don't know how to proceed", "beyond my capabilities" |

Two such signals — or one alongside a real tool failure — escalate with a quit-specific mandate; a single stray phrase does not. A separate **success-claim** detector catches "Done!" / "that should work" / "all tests pass" while failures are still in the window and demands observable evidence before the task ends; a successful tool call clears it. When a pivot fires, the pivot message asks the agent to restate the goal and the one piece of evidence that would prove it done.

A **genuine blocker** detected in tool output (permission denied, 401/403, missing credentials) outranks every persistence tier: pivoting stops and the agent is told to report the blocker and ask the user. There is no automatic path past a real blocker.

### 2. Auto-invoked playbook skill

The `nii` skill carries the full methodology: a recovery loop and a menu of strategy moves. It includes a **diversity guard** against trying the same approach twice, a note that an honest stop with evidence is a successful use of the skill, and the usual anti-patterns (cosmetic retries, unverified victory claims, spinning without recording what was ruled out).

Failure detection is window-based: any non-zero shell exit counts (a failing `cat` is a failure), the same failure twice in a row triggers an immediate pivot, and older outcomes fall out of the window rather than being erased by unrelated successes.

### 3. Bounded strategy pivot

Tool failures are counted per session and stored in a rolling window. When the window shows 3 failures, or the same failure twice, a "coach" generation reads the recorded failure signatures and proposes one genuinely different method, which is injected as a synthetic message. Two safety nets keep this honest:

- If the coach is unavailable or proposes something too close to what was already tried, a **deterministic fallback pivot** is delivered from the playbook instead.
- A failed pivot marks its strategy **ineffective** for those failures, so later coaches are told to avoid it.

The budget is **3 pivots per session**; `/nii reset` clears it so you can let the agent keep trying within the bounds you set.

**Interruption-safe delivery.** A pivot is claimed in durable state *before* delivery, but the budget is consumed only *after* the synthetic message is accepted. If a rate limit or provider error interrupts the process in between, resuming the same session replays that exact proposal instead of spending a pivot with nothing to show for it. A per-session async lock prevents concurrent model calls from delivering two different pivots.

**Provider retries.** A bounded `retry` hook extends OpenCode's policy for 429s and transient 5xx/transport failures (exponential backoff, capped delay, max 3 retries) and vetoes clearly permanent 4xx failures so they don't burn attempts. OpenCode's own hard attempt limit still applies.

### 4. Persistent learning

When a pivot is followed by a successful tool call, the proposed strategy is stored against the failure signatures that triggered it. In later sessions of the **same project**, matching failures cause those proven strategies to be offered to the coach as hints. Memory is capped at 50 entries; frequently reinforced strategies survive, and the oldest of equal-ranked entries is dropped first. `/nii status` reports how many strategies have been learned.

**State is scoped per project.** The plugin can be installed once globally, but its enable switch, failure streaks, and learning store are keyed by project id (or directory). Strategies learned in one repo cannot leak into another. To opt into a shared cross-project learning store, set `shareLearning: true` in plugin options.

### 5. Bounded escape hatch

The mandate names genuine blockers where the agent should **stop and report with evidence**, without further attempts:

- a missing credential, permission, or capability;
- an explicit user constraint forbidding the needed action;
- a proven physical or mathematical limit;
- an irreversible or high-risk action needing human approval.

Reporting a real blocker is a correct outcome, not a lack of resolve.

## Quick start

See [INSTALL.md](INSTALL.md) for the installer, global setup, and troubleshooting. Short version: plugins under `.opencode/plugins/` load automatically — no config entry required.

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
        "retryMaxRetries": 3,
        "retryBaseDelayMs": 1000,
        "retryMaxDelayMs": 30000
      }
    }
  ]
}
```

- `coachModel` — model used for the small strategy-coach generation. Defaults to the session's default model.
- `shareLearning` — default `false` keeps learning scoped to the current project; `true` opts into a shared global learning store.
- `retryMaxRetries` / `retryBaseDelayMs` / `retryMaxDelayMs` — tune the bounded retry hook (defaults: 3, 1000 ms, 30 000 ms).

Confirm it is active:

```text
/nii status
```

## Commands

| Command | Effect |
| --- | --- |
| `/nii on` | Enable the mandate for this session (clears any per-session override) |
| `/nii off` | Disable the mandate for this session — kill switch |
| `/nii reset` | Clear the failure streak and pivot budget (keeps learning) |
| `/nii status` | Show whether NII is active, pivots used, and last pivot |
| `/nii help` | Show usage |

Disabling takes effect on the very next model call, because the gate is checked inside the `context` hook. State is stored in plugin-scoped durable storage, so it survives reloads and applies only to the session that changed it.

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

See [ROADMAP.md](ROADMAP.md) for the full milestone plan — milestones 1 (core loop) and 2 (release) are 🟢, with live verification, domain depth, guardrails, and polish milestone 3–6 ahead.

## Testing

```sh
npm test           # 104 checks (unit + session/retry/atomic/quit/integration + installer/setup/uninstall)
npm run pack:check # inspect tarball contents
```

`tests/session.test.ts` drives full session lifecycles through the real state and learning modules: failure windows, one-pivot-at-a-time, successful and failed pivots, cross-session/project learning, genuine blockers, refusal escalation, pivot-budget exhaustion, and `/nii reset`.

Uses Node 24's native TypeScript support — no dependencies or build step.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and how to propose changes.

## License

Add a license before publishing. Until then, treat this as unlicensed and private.
