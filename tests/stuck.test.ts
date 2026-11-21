import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildCoachPrompt,
  emptyStuckState,
  errorSignature,
  failureCount,
  FAILURE_THRESHOLD,
  FAILURE_WINDOW,
  hasRepeatedFailure,
  isExhausted,
  isGenuineBlocker,
  isToolFailure,
  markPivoted,
  MAX_PIVOTS,
  recordFailure,
  recordSuccess,
  shouldPivot,
  toolFailureSignature,
  isRefusal,
  recordBlocker,
  recordRefusal,
  shouldEscalateRefusal,
} from "../.opencode/plugins/nii/stuck.ts"

function failures(n: number, signature = "tool.error: boom") {
  let state = emptyStuckState()
  for (let i = 0; i < n; i++) state = recordFailure(state, signature)
  return state
}

test("a failing shell command is a failure even though its event says success", () => {
  const failedShell = {
    metadata: { status: "completed", exit: 1 },
    content: [{ type: "text", text: "cat: missing: No such file or directory\nExited with code 1" }],
  }
  assert.equal(isToolFailure("session.tool.success", failedShell), true)
  assert.equal(isToolFailure("session.tool.success", { metadata: { exit: 0 } }), false)
  assert.equal(isToolFailure("session.tool.failed", { error: { message: "oops" } }), true)
  assert.equal(isToolFailure("session.tool.input.started", {}), false)
})

test("failure signatures work for shell output without an error object", () => {
  assert.equal(
    toolFailureSignature({
      metadata: { exit: 1 },
      content: [{ text: "cat: /tmp/missing: No such file\nExited with code 1" }],
    }),
    "shell: cat: <path>: No such file",
  )
})

test("failures accumulate and dedupe identical signatures", () => {
  const state = failures(4)
  assert.equal(failureCount(state), 4)
  assert.deepEqual(state.ruledOut, ["tool.error: boom"])
})

test("error signatures drop paths and keep the first line", () => {
  assert.equal(errorSignature("shell", "/tmp/build failed:\nline two"), "shell: <path> failed:")
})

test("successes do not erase earlier failures — the window does", () => {
  let state = failures(2)
  state = recordSuccess(state)
  assert.equal(failureCount(state), 2)
  assert.equal(shouldPivot(state), false)
})

test("old outcomes fall out of the window", () => {
  let state = emptyStuckState()
  for (let i = 0; i < FAILURE_WINDOW + 1; i++) state = recordSuccess(state)
  state = recordFailure(state, "only: failure")
  assert.equal(failureCount(state), 1)
  assert.deepEqual(state.recent.slice(-2), ["", "only: failure"])
})

test("the same failure twice in a row is a repeat signal", () => {
  assert.equal(hasRepeatedFailure(failures(2)), true)
  assert.equal(hasRepeatedFailure(failures(1)), false)
  assert.equal(hasRepeatedFailure(recordSuccess(failures(1))), false)
})

test("a repeat can trigger a pivot below the numeric threshold", () => {
  assert.equal(shouldPivot(failures(2)), true)
  assert.equal(shouldPivot(failures(FAILURE_THRESHOLD)), true)
})

test(`a pivot is not repeated for the same failure count`, () => {
  const state = failures(4)
  assert.equal(shouldPivot(state), true)
  assert.equal(shouldPivot(markPivoted(state)), false)
})

test("new failures after a pivot can trigger another pivot", () => {
  const state = recordFailure(markPivoted(failures(3)), "new: failure")
  assert.equal(shouldPivot(state), true)
})

test(`the pivot budget is capped at ${MAX_PIVOTS}`, () => {
  let state = emptyStuckState()
  for (let i = 0; i < MAX_PIVOTS; i++) {
    for (let j = 0; j < FAILURE_THRESHOLD; j++) state = recordFailure(state, `failure ${i}-${j}`)
    assert.equal(shouldPivot(state), true)
    state = markPivoted(state)
  }
  assert.equal(isExhausted(state), true)
  state = recordFailure(state, "one more")
  assert.equal(shouldPivot(state), false)
})

test("refusals are detected in assistant text", () => {
  assert.equal(isRefusal("I can't do this"), true)
  assert.equal(isRefusal("we cannot complete the build"), true)
  assert.equal(isRefusal("this is impossible to do"), true)
  assert.equal(isRefusal("I give up"), true)
  assert.equal(isRefusal("Nothing to refuse"), false)
  assert.equal(isRefusal("The command completed successfully"), false)
})

test("refusals accumulate and reset on success", () => {
  let state = emptyStuckState()
  state = recordRefusal(state)
  state = recordRefusal(state)
  assert.equal(state.refusals, 2)
  state = recordSuccess(state)
  assert.equal(state.refusals, 0)
  assert.equal(state.recent.length, 1)
})

test("genuine blockers are detected in tool output", () => {
  assert.equal(isGenuineBlocker("Error: permission denied for /secrets"), true)
  assert.equal(isGenuineBlocker("401 Unauthorized"), true)
  assert.equal(isGenuineBlocker("missing credentials"), true)
  assert.equal(isGenuineBlocker("cat: /tmp/file: No such file"), false)
})

test("a genuine blocker stops pivoting, even at the threshold", () => {
  const blocked = recordBlocker(failures(4))
  assert.equal(blocked.blockers, 1)
  assert.equal(shouldPivot(blocked), false)
  assert.equal(shouldPivot(failures(4)), true)
})

test("blockers are capped and benign errors are not blockers", () => {
  let state = emptyStuckState()
  for (let i = 0; i < 15; i++) state = recordBlocker(state)
  assert.equal(state.blockers, 10)
  assert.equal(isGenuineBlocker("cat: /tmp/file: No such file"), false)
  assert.equal(isGenuineBlocker("timeout after 5000ms"), false)
})

test("two text refusals escalate without a tool failure", () => {
  let state = emptyStuckState()
  state = recordRefusal(state)
  assert.equal(shouldEscalateRefusal(state), false)
  state = recordRefusal(state)
  assert.equal(shouldEscalateRefusal(state), true)
})

test("the coach prompt names what failed and demands a different method", () => {
  const prompt = buildCoachPrompt(["shell: build failed", "read: file missing"])
  assert.match(prompt, /shell: build failed/)
  assert.match(prompt, /read: file missing/)
  assert.match(prompt, /genuinely different/)
  assert.match(prompt, /observable evidence/)
  assert.doesNotMatch(prompt, /impossible/)
})

test("the coach prompt reuses strategies learned in earlier sessions", () => {
  const prompt = buildCoachPrompt(["shell: build failed"], ["switch build system"])
  assert.match(prompt, /worked for similar failures before/)
  assert.match(prompt, /switch build system/)
})
