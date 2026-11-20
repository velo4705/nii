# NII — Nothing Is Impossible

An OpenCode V2 plugin that stops an agent from abandoning hard tasks — and gives it a structured way to change approach when the current one fails.

> "Impossible" means "not yet solved with the current approach."

## Status

**V3 — motivation layer + bounded stuckness recovery + persistent strategy learning: implemented and loaded.** Phase 4 (release packaging) is prepared; the package is not yet published to npm.

## Why

Engineering and research both contain tasks that *look* impossible but are solvable with a different method. Agents tend to fail in two ways: they give up after a few failed attempts, or they keep retrying the same thing with cosmetic changes. NII addresses both by making persistence explicit, requiring **genuinely different** attempts, and requiring **observable evidence** before declaring success.

It is deliberately *bounded*. NII is not an infinite-retry loop.

## What it does

### 1. Always-on mandate

A short directive is injected into every agent-loop model call (including tool continuations) via the `context` session hook:

- Reframe "impossible" as "not yet solved with the current approach."
- Try at least three genuinely different approaches before concluding.
- If the same action fails twice, change method.
- Success means passing tests, a working artifact, or a cited source — never an unverified claim.
- Prefer the smallest verifiable step.

### 2. Auto-invoked playbook skill

The `nii` skill carries the full methodology: a six-step recovery loop and a menu of strategy moves — decompose, change representation, search prior art, remove or add a constraint, build a minimal experiment, change the tool, and use an analogy. It also lists anti-patterns (cosmetic retries, unverified victory claims, spinning without recording what was ruled out).

### 3. Bounded strategy pivot

Tool failures are counted per session. After 3 consecutive failures the agent gets a nudge to change approach; at the failure threshold a small "coach" generation reads the recorded failure signatures and proposes one genuinely different method, which is injected as a synthetic message. The budget is **3 pivots per session**. Once exhausted, the agent is directed to stop and report what was tried and what remains unverified. A successful tool call resets the failure streak but not the pivot budget.

### 4. Persistent learning

When a pivot is followed by a successful tool call, the proposed strategy is stored against the failure signatures that triggered it — globally, not per session. In later sessions, matching failures cause those proven strategies to be offered to the coach as hints. Memory is capped at 50 entries; frequently reinforced strategies survive, and the oldest of equal-ranked entries is dropped first. `/nii status` reports how many strategies have been learned.

### 5. Bounded escape hatch

The mandate names genuine blockers where the agent should **stop and report with evidence**, without further attempts:

- a missing credential, permission, or capability;
- an explicit user constraint forbidding the needed action;
- a proven physical or mathematical limit;
- an irreversible or high-risk action needing human approval.

Reporting a real blocker is a correct outcome, not a lack of resolve.

## Quick start

Local development: plugins under `.opencode/plugins/` load automatically — no config entry required.

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

Confirm it is active:

```text
/nii status
```

## Commands

| Command | Effect |
| --- | --- |
| `/nii on` | Enable the mandate for this session (clears any per-session override) |
| `/nii off` | Disable the mandate for this session — kill switch |
| `/nii status` | Show whether NII is active |
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
  SKILL.md       # path target for the registered skill
tests/           # node:test suite
README.md
CONTRIBUTING.md
```

## Roadmap

Work is structured in phases. Each phase has observable acceptance criteria.

| Phase | Goal | Acceptance criteria |
| --- | --- | --- |
| 0 — Repo hygiene | Docs and ignore rules | ✅ `README.md`, `CONTRIBUTING.md`, `.gitignore` present |
| 1 — V1 safety net | Automated checks for the motivation layer | ✅ 14 checks green (mandate, playbook sync, command routing, on/off state) |
| 2 — Stuckness → pivot | Detect repeated failure and propose a different approach | ✅ 8 more checks green; failure streak, threshold, pivot cap, and coach prompt verified; plugin reloads cleanly |
| 3 — Persistent learning | Strategy memory across sessions | ✅ 6 more checks green; successful pivots stored globally, reused as coach hints, capped at 50 |
| 4 — Release ready | Publishable package | ✅ MIT license, `exports`/`files`, tarball installs and loads in a fresh project |

Publishing itself is intentionally not done — it needs your npm account. The name `opencode-nii` is available (the short name `nii` is already taken on npm). When ready:

```sh
npm login
npm publish
```

## Testing

```sh
npm test           # 29 checks
npm run pack:check # inspect tarball contents
```

Uses Node 24's native TypeScript support — no dependencies or build step.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and how to propose changes.

## License

Add a license before publishing. Until then, treat this as unlicensed and private.
