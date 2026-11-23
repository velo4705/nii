---
name: nii
description: Use when a task seems impossible, after repeated failures, or before giving up. Reframe, switch approach, and verify success with evidence.
---

# NII — Nothing Is Impossible

"Impossible" means "not yet solved with the current approach." Keep working until you have verified success or a genuine blocker.

## Memory

Read `.nii/memory.json` if it exists. It records ruled-out paths and strategies that worked in this project. Do not repeat a failed approach from that ledger. Update it when you rule out a path or find a working method.

## The loop

1. Name the precise blocker.
2. Define observable evidence that would prove the task done.
3. List at least three genuinely different approaches. Three is a floor, not a ceiling.
4. Take the smallest step of one approach and verify it.
5. If it failed, record why and pick an approach you have not used.

## Validation matrix

For each proposed method, test up to seven cases across four categories:

1. Trivial or absurd input. Failing here discards the method.
2. Typical input.
3. Boundary input.
4. Adversarial input the method should fail gracefully on. Success here is a warning sign.

Report observed tool output, not reasoning.

## Stop rules

Stop and report with evidence when:

- a verified check passes and you have signalled completion;
- a credential, permission, or capability is genuinely missing;
- the user explicitly interrupts or asks a question that requires their answer;
- a hard budget set by the user is spent, in which case hand back the full ledger.

## Cheating

Do not delete failing tests, comment out assertions, replace logic with TODO stubs, or claim completion without verification. A green result obtained that way is a failure.

## Completion signal

Only emit `<nii:done />` after verification has actually passed.
