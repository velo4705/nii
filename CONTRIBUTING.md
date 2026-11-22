# Contributing to NII

Thanks for helping make persistence a first-class agent behavior.

## Setup

1. Clone or open the project.
2. Open it with OpenCode V2 (`v2.0.32` or later). The plugin lives in `.opencode/plugins/nii/` and auto-loads; no `opencode.json` entry is needed.
3. Confirm the load in the server log (`~/.local/share/opencode/log/opencode.log`, or your platform's equivalent):

   ```text
   msg="loading plugin" id=.../.opencode/plugins/nii entrypoint=.../index.ts
   ```

4. Run `/nii status` inside OpenCode. It should report `ON`.

There is no build step. The plugin is plain TypeScript loaded by OpenCode.

## Layout

| File | Responsibility |
| --- | --- |
| `.opencode/plugins/nii/index.ts` | `Plugin.define`, hook and transform registration, event subscription, command routing |
| `.opencode/plugins/nii/playbook.ts` | All user-facing text: mandate, skill content, escalation, pivot, help and status |
| `.opencode/plugins/nii/state.ts` | Plugin-storage state: enable switch, per-session override, stuck state |
| `.opencode/plugins/nii/stuck.ts` | Pure failure/pivot logic — thresholds, cap, error signatures, coach prompt |
| `.opencode/plugins/nii/learning.ts` | Pure strategy memory — reward, ranking, cap, matching |
| `.opencode/plugins/nii/commands.ts` | Pure `/nii` argument parsing |
| `.opencode/plugins/nii/api.ts` | Compatibility shim for `generate.text` vs `experimental.generate.text` |
| `tests/` | `node:test` checks for every pure module |

## Testing

```sh
npm test
```

Node 24 runs the TypeScript tests directly. There is no build step and no dependency install. Add a test whenever you change a threshold, a prompt, or a storage key. Keep new logic pure and in `stuck.ts`, `commands.ts`, `api.ts`, or `playbook.ts` so it can be tested without loading OpenCode.

For live verification, use a fresh project directory with `opencode run --standalone`. A shared server keeps old plugin instances alive across hot reloads, and those stale instances can overwrite the same plugin-storage keys and hide the behavior you are trying to observe.

Keep these boundaries. In particular, keep prompt text in `playbook.ts` so the mandate stays easy to review.

Two details of the self-evolution logic need care when you change them:

- Failure detection counts a failing shell command as a failure even though its event says `session.tool.success` with `metadata.exit`; a same-failure-twice pattern triggers a pivot immediately. If you add signal types, update `isToolFailure`.
- Quit detection scans assistant text with `detectQuitSignals` (refusal, handoff, partial, uncertainty) and `isSuccessClaim`. Two quit signals (or one plus a tool failure) escalate; success claims demand evidence. Genuine blockers are detected separately with `isGenuineBlocker` and outrank persistence — never make that tier softer. When adding patterns, add a test with the exact phrasing; contractions and plurals are easy to miss.
- `state.ts` keys all durable state by project. If you add a key, include `projectScope(ctx)` in it; leaking state across projects is a correctness bug.
- Pivot delivery is claim → deliver → finalize (`claimPivot` / `finalizePivot` in `stuck.ts`), serialized by `withLock` in `lock.ts`. Never move budget consumption before the synthetic message is accepted — that would reintroduce "pivot spent but never delivered" on interruption.
- Validation lives in `validation.ts`. Keep the case matrix bounded and never present a strategy as universal — store the observed bounds with the learning entry. When you add a category, add detection patterns and a report test.
- Retry policy lives in `retry.ts`. Keep it bounded and leave unknown errors to OpenCode's own policy.
- When you touch `buildCoachPrompt`, preserve the diversity guard (`isDistinctEnough`) — the point is that a new approach is actually new.

## Conventions

- **Keep the mandate short and stable.** It is injected on every agent-loop model call. Long or frequently-changing text costs tokens and hurts prompt caching. Put detail in the skill, not the mandate.
- **Keep hooks cheap and retry-safe.** A `context` hook may be called many times and more than once for the same logical turn. Read state, decide, return. Do not perform side effects there.
- **Use the official API surface.** Prefer `ctx.session.hook`, `ctx.skill.transform`, `ctx.command.transform`, and `ctx.storage` over reaching into internals. Verify signatures against the [V2 plugin docs](https://opencode.ai/v2/docs/build/plugins) before using unfamiliar fields.
- **Bound every persistence mechanism.** Any new retry, pivot, or loop needs a cap, a verifiable-success condition, and a genuine-blocker escape hatch.
- **No unverified success claims.** Changes to behavior should come with an observable check — a log line, a command response, a test, or a captured hook event.

## Adding a strategy move

1. Add the move to `SKILL_PLAYBOOK` in `playbook.ts` **and** to `SKILL.md` — keep them identical.
2. Write it as an imperative action with a one-line explanation.
3. Do not add it to the base mandate; the mandate points to the playbook.

## Changing enable/disable behavior

Edit only `state.ts`. Keys are `nii:enabled` (global) and `nii:session:<sessionID>:enabled` (override). Unknown or unset values default to **enabled**, so a storage failure never silently disables the plugin.

## Reporting a bug

Include:

- OpenCode version (`opencode --version`);
- the relevant lines from the server log with API keys, prompts, and file contents redacted;
- the exact command or situation that reproduced it;
- what you expected vs. what happened.

## Pull requests

1. Keep each PR scoped to one phase or one concern.
2. Update `README.md` when behavior or commands change.
3. State the acceptance criterion your PR satisfies and the evidence that it does.
4. If you add a new hook, confirm it works with `/nii off` as well as `/nii on`.

## Release

The package is `opencode-nii`, MIT-licensed. `npm pack --dry-run` must show exactly: the seven files in `.opencode/plugins/nii/`, `package.json`, `README.md`, `CONTRIBUTING.md`, and `LICENSE`. A tarball must install with `npm install <tarball>` and the installed plugin files must load from a fresh project's `.opencode/plugins/` directory.

Publishing is a separate, explicit step (`npm login && npm publish`) and requires the maintainer's npm account. Do not publish as part of a normal PR.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the milestone plan: core loop and release are done (🟢); live-loop verification, domain depth, guardrails, and polish are 🟡/🔴 ahead. New work should reference its milestone and acceptance criteria there.

## Philosophy

We are not trying to make the agent stubborn. We are trying to make it resourceful, honest about evidence, and willing to stop when the obstacle is real. Changes that increase persistence without increasing *approach diversity* are not improvements.
