import assert from "node:assert/strict"
import { test } from "node:test"
import {
  buildCoachPrompt,
  emptyStuckState,
  errorSignature,
  FAILURE_THRESHOLD,
  isToolFailure,
  isExhausted,
  markPivoted,
  MAX_PIVOTS,
  recordFailure,
  recordSuccess,
  shouldPivot,
  toolFailureSignature,
} from "../.opencode/plugins/nii/stuck.ts"

function streakOf(n: number, signature = "tool.error: boom") {
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

test("failures accumulate into a streak and dedupe identical signatures", () => {
  const state = streakOf(4)
  assert.equal(state.streak, 4)
  assert.deepEqual(state.ruledOut, ["tool.error: boom"])
})

test("error signatures drop paths and keep the first line", () => {
  assert.equal(
    errorSignature("shell", "/tmp/build failed:\nline two"),
    "shell: <path> failed:",
  )
})

test("a success resets the streak but keeps the pivot budget", () => {
  const pivoted = markPivoted(streakOf(3))
  const afterSuccess = recordSuccess(pivoted)
  assert.equal(afterSuccess.streak, 0)
  assert.equal(afterSuccess.pivots, 1)
})

test(`a pivot is offered at ${FAILURE_THRESHOLD} failures, not before`, () => {
  assert.equal(shouldPivot(streakOf(FAILURE_THRESHOLD - 1)), false)
  assert.equal(shouldPivot(streakOf(FAILURE_THRESHOLD)), true)
})

test("a pivot is not repeated for the same streak", () => {
  const state = streakOf(4)
  assert.equal(shouldPivot(state), true)
  assert.equal(shouldPivot(markPivoted(state)), false)
})

test("a further failure after a pivot can trigger another pivot", () => {
  const state = recordFailure(markPivoted(streakOf(3)), "new: failure")
  assert.equal(shouldPivot(state), true)
})

test(`the pivot budget is capped at ${MAX_PIVOTS}`, () => {
  let state = emptyStuckState()
  for (let i = 0; i < MAX_PIVOTS; i++) {
    state = markPivoted(recordFailure(state, `failure ${i}`))
  }
  assert.equal(isExhausted(state), true)
  assert.equal(shouldPivot(recordFailure(state, "one more")), false)
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
