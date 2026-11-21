# NII — Milestone Roadmap

This is NII's milestone roadmap. Each milestone has a goal and observable acceptance criteria, matching the project's scope. Milestones are small and sequential where dependencies require it.

Legend:

- 🟢 Done
- 🟡 Planned
- 🔴 In progress

---

## Milestone 1 — Core loop 🟢

*Motivation layer + bounded stuckness recovery + persistent strategy learning.*

**Goal:** NII as it is today — every model call carries an adaptive mandate; tool failures trigger coach-generated pivots; successful pivots become reusable strategy memory.

**Milestone status:** 🟢

**Acceptance criteria (green on `npm test`):**

- Failure detection catches non-zero shell exits, tool-level errors, and "chatty" repetition; window-based so unrelated successes don't erase evidence.
- At the failure threshold, a small generation proposes a genuinely different approach, injected as a synthetic message. Budget: 3 pivots per session.
- When a pivot succeeds, the strategy is stored globally and reused as a coach hint in later sessions; when it fails, it is marked ineffective for those failures.
- `/nii on`, `/nii off`, `/nii reset`, `/nii status`, `/nii help` behave as documented.
- Mandatory: the fallback pivot fires when the coach is unavailable or proposes something too close to what was tried — the loop must never die silently.

**New in this milestone (added post-release review):**

- **Refusal detection** — assistant text claiming inability ("I can't do this", "impossible", "give up") increments a `refusals` counter, which escalates the mandate immediately.
- **Proactive strategy hints** — when failures exist but no pivot has fired, the context hook surfaces strategies that are already known to have worked for those failures.
- **Goal restatement on pivot** — the pivot message now asks the agent to restate the goal in one sentence and define the observable evidence that would prove it done.

**Drawback fixes (post-release review):**

- **Per-project state** — enable switch, streaks, and learning are keyed by project; `shareLearning: true` opts into a shared global store.
- **Genuine blocker detection** — permission denied / 401 / 403 / missing credentials stop the pivot loop and deliver a stop-and-report mandate.
- **Refusal tuning** — two refusals, or one refusal plus a tool failure, are required before escalating; `verify` was removed from refusal verbs to avoid blocking on "I can't verify the key" (which is handled as a genuine blocker instead).
- **Coach model option** — `coachModel` plugin option selects the coach model; deterministic fallback covers coach/API failures.

**Milestone status:** 🟢

Refusals and goal restatement are additions to this milestone's acceptance criteria, added during post-release review.

**Live evidence (from the isolated-server verification):** failure events increment the windowed streak, `PIVOT-TRIGGERED` fires at 3 failures. The model-API outage during this phase is tracked as Milestone 3 work.

---

## Milestone 2 — Release 🟢

*MIT license, packaged, installable from npm.*

**Goal:** Publish `opencode-nii` so users can load it with `"plugins": ["opencode-nii"]`.

**Milestone status:** 🟢

**Acceptance criteria:**

- Package name `opencode-nii` verified available on npm.
- `npm pack` produces the expected 12 files, including the hidden plugin directory.
- Tarball installs and loads in a fresh project.
- Legal docs complete (`LICENSE`, `README.md`, `CONTRIBUTING.md` accurate).

**Publishing is the human step** — needs the maintainer's npm account.

---

## Milestone 3 — Live-loop verification 🔴

*Prove the pivot → learning loop end-to-end in a real session.*

**Goal:** Observe a real agent get 3 tool failures, receive a `[NII — strategy pivot]` message, and complete a follow-up step — the full chain, observed, not just unit-tested.

**Milestone status:** 🔴 (blocked by external model-API outage)

**Acceptance criteria:**

- A three-command failing prompt produces the pivot message verbatim in the final answer.
- Optionally, a subsequent successful tool call lands as a stored learning entry and shows in `/nii status` as `Strategies learned: 1`.

---

## Milestone 4 — Domain depth 🟡

*Broaden "stuckness" to engineering and research failure modes.*

**Goal:** The detection layer learns real signals, not just shell exit codes.

**Signals to add (state and track per session):**

- **Provider retries** — persistent `session.retry.scheduled` loops escalate motivation intensity over time.
- **Time-bounded persistence** — repeated failures with no *new* distinctly-worded outcome for 30+ seconds count toward the threshold.
- **Goal text detection** — scan assistant text for refusal patterns ("I can't do this", "this is impossible") before concluding.

**Learning depth:**

- Store goals alongside strategies; when a strategy is learned, attach a short goal signature so future coaches get context.
- Decay unused learning with a TTL, so stale strategies don't crowd out fresh ones.

**Acceptance:** new pure logic covered by tests; live spot-check of retry escalation.

---

## Milestone 5 — Guardrails & exit paths 🟡

*Make the bounded behavior airtight and reversible.*

**Goal:** Turn NII's "impossible is possible" into a conversation with the user instead of an infinite automatic loop, by default.

**Guardrail pieces:**

- **User-facing budget summary** — `/nii status` reports remaining pivots and time-since-last-pivot.
- **Auto-pause** — a session with 3 pivots and no new distinct outcomes in the last N minutes pauses: the model gets a message that says "call user — plan exhausted" instead of another pivot.
- **Learner recording** — every pivot attempt/approach is written to session instructions as `nii/pivot-log` so the full story is visible in the transcript.
- **`/nii reset` evidence** — reset also records *why* in the transcript when run.

**Acceptance:** pause behavior testable by driving the state machine to exhaustion; all new pure logic tested.

---

## Milestone 6 — Package-level polish 🟡

*Small-bore, high-value consistency.*

- Ensure `/nii` works identically in V1 and V2 (if loaded via V2 `server`) — code review.
- Publish `@nii/nii` as a scoped alias? (Formalizes the identity users know from `nii`.)
- Add `CHANGELOG.md` with release notes.
- Add a `nii self-test` command that re-runs `npm test` from the plugin.

---

## Backlog (unscheduled ideas)

- Replace `ctx.model.default()` for the coach with a per-plugin option (`coachModel`) — tunable per project.
- Make effective/ineffective thresholds plugin options via `ctx.options` (`threshold`, `maxPivots`, `window`).
- Add optional payload for `/nii` command when called with a goal: `/nii pivot <goal>` seeds goal context for the next pivot.
- TUI improvements: highlight system-injection in OpenCode's UI.
- Docker/shell-level tests for the fallback pivot path (coach mocked to fail).
- Fuzz the diversity guard with paraphrased proposals.

---

*Roadmap written: 21-Nov-2026. Updated as work completes.*
