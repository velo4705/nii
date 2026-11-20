# NII — Nothing Is Impossible

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

The user can disable NII at any time with `/nii off`. Obey immediately.
