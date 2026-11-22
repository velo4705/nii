import assert from "node:assert/strict"
import { test } from "node:test"
import {
  claimedAttemptCount,
  detectQuitSignals,
  emptyStuckState,
  isRefusal,
  isSuccessClaim,
  needsVerification,
  QUIT_KINDS,
  recordFailure,
  recordSuccess,
  recordSuccessClaim,
} from "../.opencode/plugins/nii/stuck.ts"
import { motivationFor, quitResponse, VERIFY_MANDATE } from "../.opencode/plugins/nii/playbook.ts"

test("refusals are still detected", () => {
  assert.deepEqual(detectQuitSignals("I can't do this"), ["refusal"])
  assert.deepEqual(detectQuitSignals("we cannot complete the migration"), ["refusal"])
  assert.equal(isRefusal("I can't do this"), true)
})

test("handoffs to the user are detected as quitting", () => {
  assert.deepEqual(detectQuitSignals("You'll need to do this manually."), ["handoff"])
  assert.deepEqual(detectQuitSignals("I give up, please handle it yourself."), ["handoff"])
  assert.ok(detectQuitSignals("We need a human for this step").includes("handoff"))
})

test("partial answers are detected as quitting", () => {
  assert.deepEqual(detectQuitSignals("That's all I can do."), ["partial"])
  assert.deepEqual(detectQuitSignals("Here is a partial solution."), ["partial"])
  assert.ok(detectQuitSignals("Best I can manage for now").includes("partial"))
})

test("uncertainty declarations are detected as quitting", () => {
  assert.deepEqual(detectQuitSignals("I don't know how to proceed."), ["uncertainty"])
  assert.deepEqual(detectQuitSignals("This is beyond my capabilities."), ["uncertainty"])
})

test("a single text can carry several quit signals", () => {
  const kinds = detectQuitSignals("I give up, this is a partial solution and I don't know how to continue")
  assert.ok(kinds.includes("handoff"))
  assert.ok(kinds.includes("partial"))
  assert.ok(kinds.includes("uncertainty"))
  assert.ok(kinds.length >= 3)
})

test("a low attempt count is treated as quitting", () => {
  assert.deepEqual(detectQuitSignals("I tried it three different ways"), ["exhaustion"])
  assert.deepEqual(detectQuitSignals("We ran out of approaches"), ["exhaustion"])
  assert.equal(claimedAttemptCount("I tried it three different ways"), 3)
  assert.equal(claimedAttemptCount("I tried 5 approaches"), 5)
  assert.equal(claimedAttemptCount("I tried everything"), undefined)
})

test("negative-action announcements are quit signals", () => {
  for (const text of [
    "I'm stuck",
    "I'll stop here",
    "I can't continue",
    "no point in trying",
    "this is a dead end",
    "nothing else I can do",
    "I'm done trying",
  ]) {
    assert.deepEqual(detectQuitSignals(text), ["stall"], text)
  }
})

test("a user quit signal gets a directive injected into the prompt", () => {
  const signals = detectQuitSignals("I can't make it")
  assert.ok(signals.length > 0)
  const directive = quitResponse(signals)
  assert.match(directive!, /A quit signal was detected/)
  assert.match(directive!, /at least three genuinely different approaches/)
  assert.equal(quitResponse([]), undefined)
})

test("claims that a thing cannot be built are refusals", () => {
  assert.ok(detectQuitSignals("it can't be built").includes("refusal"))
  assert.ok(detectQuitSignals("that cannot be done").includes("refusal"))
  assert.ok(detectQuitSignals("there's no way around it").includes("refusal"))
})

test("ordinary progress text is not a quit signal", () => {
  assert.deepEqual(detectQuitSignals("I updated the parser and ran the tests"), [])
  assert.deepEqual(detectQuitSignals("The build is green"), [])
  assert.equal(QUIT_KINDS.length, 6)
})

test("success claims are detected separately", () => {
  assert.equal(isSuccessClaim("Done!"), true)
  assert.equal(isSuccessClaim("That should work now"), true)
  assert.equal(isSuccessClaim("All tests pass"), true)
  assert.equal(isSuccessClaim("I'm still debugging"), false)
})

test("a success claim only demands verification while failures remain", () => {
  let state = emptyStuckState()
  state = recordSuccessClaim(state)
  assert.equal(needsVerification(state), false)
  state = recordFailure(state, "shell: one")
  assert.equal(needsVerification(state), true)
  assert.equal(motivationFor(state, 3).includes(VERIFY_MANDATE), true)

  state = recordSuccess(state)
  assert.equal(needsVerification(state), false)
  assert.equal(state.successClaims, 0)
})
