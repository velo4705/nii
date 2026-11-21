/**
 * NII — Nothing Is Impossible
 *
 * Text assets for the motivation layer. Kept in one place so the system
 * mandate stays short and stable (it is injected on every agent-loop call),
 * while the full playbook lives in the auto-invoked skill.
 */

import { failureCount, type StuckState } from "./stuck.ts"

/** Short, stable mandate pushed into the agent-loop system instructions. */
export const BASE_MANDATE = `NII — NOTHING IS IMPOSSIBLE is active for this session.

Treat "impossible" as "not yet solved with the current approach." Do not abandon a task merely because it looks impossible or because one attempt failed.

Rules:
- Before concluding, try at least three genuinely different approaches. Changing a parameter or re-running the same command is not a new approach.
- If the same action fails twice, stop repeating it and switch method.
- Success means observable evidence: passing tests, a working artifact, or a cited source. Never claim success without it.
- Prefer the smallest verifiable step over a perfect plan.

Genuine blocker — stop and report with evidence instead of pushing further: a missing credential or permission, an explicit user constraint, a proven physical or mathematical limit, or an irreversible action that needs approval. Reporting a real blocker is a correct outcome, not a lack of resolve.

The user can disable this at any time with /nii off. Obey immediately.`

/** Added to the system instructions after repeated failures. */
export const STUCK_NUDGE = `NII stuckness signal: the recent tool calls failed repeatedly. Do not retry the same action with cosmetic changes. State what failed, then use the nii playbook to pick a genuinely different approach before continuing.`

/** Added once a pivot has been delivered or failures cross the threshold. */
export const ESCALATED_MANDATE = `NII escalation: the current method is not working. Stop adjusting parameters and name the precise blocker. Choose a mechanism you have NOT used yet from the nii playbook, take the smallest step, and verify it. Do not report failure until the playbook's strategy moves are exhausted.`

/** Added once the pivot budget is spent: persistence must stop being automatic. */
export const EXHAUSTED_MANDATE = `NII pivot budget exhausted for this session. Stop attempting new approaches on your own. Report with evidence: what you tried, what failed, what remains unverified, and which genuine blocker applies. Ask the user before continuing. This is a correct outcome, not a failure of resolve.`

/**
 * One coherent, adaptive motivation directive. Intensity rises with evidence
 * of stuckness, then deliberately falls away once the budget is spent so the
 * agent stops pushing on its own.
 */
export function motivationFor(state: StuckState, maxPivots: number): string {
  const failures = failureCount(state)
  if (state.pivots >= maxPivots) return `${BASE_MANDATE}\n\n${EXHAUSTED_MANDATE}`
  if (state.pivots > 0 || failures >= 3 || state.refusals > 0) {
    return `${BASE_MANDATE}\n\n${ESCALATED_MANDATE}`
  }
  if (failures >= 2) return `${BASE_MANDATE}\n\n${STUCK_NUDGE}`
  return BASE_MANDATE
}

/** Deterministic pivot used when the coach is unavailable or unoriginal. */
export function fallbackProposal(ruledOut: readonly string[]): string {
  const tried = ruledOut.length > 0 ? `\n\nAlready failed: ${ruledOut.slice(0, 4).join("; ")}.` : ""

  return `The strategy coach is unavailable, so use the playbook directly.${tried}

Pick ONE strategy move you have not used yet: decompose the goal; change representation; search prior art; remove an assumed constraint; build a minimal experiment; switch tool or environment; borrow an analogy from another domain. Take the smallest step of that move and define the observable evidence that would prove it worked. Do not repeat a failed approach with cosmetic changes.`
}

export function pivotMessage(proposal: string, pivotNumber: number, maxPivots: number): string {
  return `[NII — strategy pivot ${pivotNumber}/${maxPivots}] The current approach has failed repeatedly. Change method now.

${proposal.trim()}

Goal restatement: restate in one sentence the goal you are now solving, and the one piece of observable evidence that would prove it done. If your first attempt to restate matches a failed approach, pick a different one.

Verify the result with observable evidence. If this also fails, NII will propose one more different approach until the budget is spent.`
}

/** Longer methodology used by the auto-invoked `nii` skill. */
export const SKILL_PLAYBOOK = `# NII — Nothing Is Impossible

Use this skill when a task looks impossible, after repeated failures, or whenever you feel the urge to say "I can't."

## Mindset

"Impossible" is a statement about the current method, not about the goal. Your job is to find the method. Do not lower the goal; change the approach.

## The loop

1. Name the blocker precisely — "cannot do X" is not a blocker; "tool Y rejects input Z because of reason R" is.
2. Restate the goal as a verifiable outcome — what observable evidence would prove it done?
3. List three approaches that are *genuinely* different (different mechanism, not different parameters).
4. Take the smallest step of the most promising approach.
5. Verify against the evidence from step 2. Do not accept your own assertion of success.
6. If it failed, record why, remove that approach from the list, and go back to step 3.

## Strategy moves

Pick one you have not tried yet:

- **Decompose** — split the goal until one piece is doable now.
- **Change representation** — encode the problem differently (data structure, diagram, algebra, search space).
- **Search prior art** — someone may have solved this; look it up before inventing.
- **Remove an assumption** — which constraint are you treating as fixed that is actually negotiable?
- **Add a constraint** — artificially narrow the problem to make a first solution reachable.
- **Build a minimal experiment** — test the single risky assumption in isolation.
- **Change the tool** — a different API, language, model, or environment may be the key.
- **Use an analogy** — borrow the solution from a neighbouring domain.

## Anti-patterns

- Re-running the same failing command with cosmetic changes.
- Declaring victory on unverified output.
- Spinning indefinitely without recording what has been ruled out.
- Treating a permission or credential problem as a reasoning problem.

## Stop rules

Stop and report *with evidence*, without further attempts, when:

- a credential, permission, or capability is genuinely missing;
- the user has set an explicit constraint that forbids the needed action;
- the limit is proven physical or mathematical;
- the next step is irreversible or high-risk and needs human approval.

A honest stop with evidence is a successful use of this skill. Only give up on the *approach*, never on the goal — unless the goal itself is the genuine blocker.

The user can disable NII at any time with \`/nii off\`. Obey immediately.`

export const HELP_TEXT = `NII — Nothing Is Impossible

Usage: /nii [on|off|reset|status|help]

  on      Enable the NII mandate for this session
  off     Disable the NII mandate for this session (kill switch)
  reset   Clear this session's failure streak and pivot budget (keeps learning)
  status  Show whether NII is active for this session
  help    Show this message

NII treats "impossible" as "not yet solved with the current approach", requires
genuinely different attempts and verifiable success, and stops with evidence
when a blocker is real.`

export function statusText(
  enabled: boolean,
  scope: "session" | "global",
  pivots?: number,
  maxPivots?: number,
  learned?: number,
  lastPivot?: string,
): string {
  const budget = pivots === undefined || maxPivots === undefined ? "" : `\n\nStrategy pivots used: ${pivots}/${maxPivots}.`
  const memory = learned === undefined ? "" : `\nStrategies learned: ${learned}.`
  const recent = lastPivot ? `\nLast pivot: ${lastPivot.slice(0, 160)}` : ""

  return `NII status: ${enabled ? "ON" : "OFF"} (${scope}).${budget}${memory}${recent}

${enabled ? BASE_MANDATE : "The NII mandate is disabled for this session. Standard behavior applies."}`
}
